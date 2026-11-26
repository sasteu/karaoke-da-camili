import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {parseSong} from './public/music.mjs';
import {NativeMicrophone} from './native-microphone.mjs';
import {LyricsReviews,prepareLyrics,compareLyrics,cleanLyrics} from './lyrics-review.mjs';
import {resolveMediaInput} from './media-input.mjs';
import {identifySong} from './song-identity.mjs';
import {SongTrash,songKey} from './song-trash.mjs';
import {HighScores} from './high-scores.mjs';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.dirname(dir),data=path.resolve(process.env.KARAOKE_DATA_DIR||path.join(root,'dados','web-karaoke'));
const runFile=promisify(execFile),audioEvents=[];
const lyricsReviews=new LyricsReviews();
await fsp.mkdir(data,{recursive:true});
const port=Number(process.env.KARAOKE_PORT||8787),songRoot=path.resolve(process.env.KARAOKE_SONGS_DIR||path.join(root,'musicas')),clients=new Set(),jobs=[],library=new Map(),catalog=new Map();
const songTrash=new SongTrash(path.join(data,'lixeira-musicas.json'));await songTrash.load();
const state={queue:[],current:null,playing:false,time:0,score:0,singer:'',owner:null,ownerSeen:0};
const nativeMic=new NativeMicrophone(path.join(root,'runtime','PFiles','UltrastarCreatorTool','resources','backend','_internal','ffmpeg.exe'));
function localMicrophoneRequest(req) {
  const address=req.socket.remoteAddress;
  const host=new URL(`http://${req.headers.host}`).hostname;
  return ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(address)&&['localhost','127.0.0.1','[::1]'].includes(host)&&req.headers['sec-fetch-site']!=='cross-site'&&(!req.headers.origin||req.headers.origin===`http://${req.headers.host}`);
}
let history=[];try{history=JSON.parse(await fsp.readFile(path.join(data,'historico.json'),'utf8'));}catch{}
const highScores=new HighScores(path.join(data,'recordes.json'));await highScores.load(history);
const publicState=()=>({...state,ownerSeen:undefined,jobs,history:history.slice(0,10)});
function broadcast(){const event=`data: ${JSON.stringify(publicState())}\n\n`;for(const c of clients)c.write(event);}
function libraryChanged(){for(const client of clients)client.write('event: library\ndata: {}\n\n');}
const json=(res,obj,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(obj));};
async function body(req){let parts=[],size=0;for await(const b of req){size+=b.length;if(size>128000)throw new Error('Solicitação muito grande.');parts.push(b);}return JSON.parse(Buffer.concat(parts).toString()||'{}');}
async function scan(){
  const next=new Map();async function walk(folder,depth=0){if(depth>8)return;for(const e of await fsp.readdir(folder,{withFileTypes:true}).catch(()=>[])){
    const p=path.join(folder,e.name);if(e.isSymbolicLink())continue;if(e.isDirectory()){await walk(p,depth+1);continue;}if(!e.name.endsWith('.txt')||e.name.includes('_summary'))continue;
    try{const chartText=await fsp.readFile(p,'utf8'),chart=parseSong(chartText),h=chart.headers;const name=h.INSTRUMENTAL||h.MP3||h.AUDIO;if(!name||path.basename(name)!==name)continue;const audio=path.join(folder,name),audioStat=await fsp.stat(audio);if(!audioStat.isFile())continue;
      const id=createHash('sha256').update(path.relative(songRoot,p)).digest('hex').slice(0,16);
      const fingerprint=createHash('sha256').update(chartText+'\0'+audioStat.size+'\0'+audioStat.mtimeMs).digest('hex');
      const files=await fsp.readdir(folder),plain=files.find(n=>/\.mp3$/i.test(n)&&!/[\[\]]/.test(n));
      const original=plain?path.join(folder,plain):audio;
      const vocalName=files.find(n=>/\[VOC\]\.mp3$/i.test(n));
      const vocals=vocalName?path.join(folder,vocalName):null;
      let videoId='';try{videoId=new URL(h.YOUTUBE).searchParams.get('v')||'';}catch{}
      const cover=/^[\w-]{11}$/.test(videoId)?`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`:null;
      next.set(id,{id,fingerprint,title:h.TITLE||e.name,artist:h.ARTIST||'Artista desconhecido',language:h.LANGUAGE||'',notes:chart.notes,lines:chart.lines,audio,original,vocals,cover,hasOriginal:original!==audio,hasVocals:!!vocals,seconds:Math.max(...chart.notes.map(n=>n.end)),noteCount:chart.notes.length});
    }catch(err){console.log('Não carregado:',e.name,err.message);}
  }}await walk(songRoot);library.clear();catalog.clear();const seen=new Set();for(const [id,s]of next){catalog.set(id,s);if(songTrash.has(s))continue;const key=songKey(s);if(seen.has(key))continue;seen.add(key);library.set(id,s);}
}
await scan();
const songs=()=>[...library.values()].map(({audio,original,vocals,notes,lines,fingerprint,...s})=>({...s,highScore:highScores.best(s)}));
function serveFile(req,res,file,mime){
  const st=fs.statSync(file);let start=0,end=st.size-1,status=200;
  if(req.headers.range){const m=req.headers.range.match(/^bytes=(\d*)-(\d*)$/);if(!m){res.writeHead(416,{'Content-Range':`bytes */${st.size}`});return res.end();}
    if(!m[1])start=Math.max(0,st.size-Number(m[2]));else{start=Number(m[1]);if(m[2])end=Math.min(end,Number(m[2]));}
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=st.size){res.writeHead(416,{'Content-Range':`bytes */${st.size}`});return res.end();}status=206;
  }
  const headers={'Content-Type':mime,'Content-Length':end-start+1,'Accept-Ranges':'bytes','Cache-Control':'no-cache'};if(status===206)headers['Content-Range']=`bytes ${start}-${end}/${st.size}`;res.writeHead(status,headers);if(req.method==='HEAD')return res.end();fs.createReadStream(file,{start,end}).pipe(res);
}
const base=process.env.KARAOKE_BACKEND_URL||'http://127.0.0.1:8001';
if(!['localhost','127.0.0.1','[::1]'].includes(new URL(base).hostname))throw new Error('O processador de músicas deve rodar neste computador.');
let ownedBackend=null;
async function backend(route,options={}){const r=await fetch(base+'/api'+route,{...options,signal:AbortSignal.timeout(120000)});if(!r.ok){let d=await r.text();try{d=JSON.parse(d).message||JSON.parse(d).detail||d;}catch{}throw new Error(typeof d==='string'?d:'O processador não conseguiu concluir esta etapa.');}return r.json();}
async function ensureBackend(){try{await backend('/health');return;}catch{}
  const profile=path.join(root,'dados');const env={...process.env,APPDATA:path.join(profile,'appdata'),LOCALAPPDATA:path.join(profile,'localappdata'),USERPROFILE:profile,HF_HOME:path.join(profile,'huggingface'),TORCH_HOME:path.join(profile,'.cache','torch'),TEMP:path.join(profile,'temp'),TMP:path.join(profile,'temp'),ULTRASTAR_APP_VERSION:'5.0.0'};
  const log=fs.openSync(path.join(data,'processador.log'),'a');ownedBackend=spawn(path.join(root,'runtime','PFiles','UltrastarCreatorTool','resources','backend','backend.exe'),[],{env,windowsHide:true,stdio:['ignore',log,log]});ownedBackend.on('error',e=>console.error(e.message));
  try{os.setPriority(ownedBackend.pid,os.constants.priority.PRIORITY_BELOW_NORMAL);}catch{}
  for(let i=0;i<90;i++){await new Promise(r=>setTimeout(r,1000));try{await backend('/health');return;}catch{if(ownedBackend.exitCode!==null)break;}}throw new Error('Não foi possível iniciar o processador de músicas.');
}
async function stream(route,onEvent){const r=await fetch(base+'/api'+route,{signal:AbortSignal.timeout(3600000)});if(!r.ok)throw new Error('Não foi possível iniciar o processamento.');let pending='',last;const decoder=new TextDecoder();for await(const chunk of r.body){pending+=decoder.decode(chunk,{stream:true});const blocks=pending.split('\n\n');pending=blocks.pop();for(const block of blocks){const l=block.split('\n').find(l=>l.startsWith('data: '));if(!l)continue;const e=JSON.parse(l.slice(6));if(e.phase==='error'||e.type==='error')throw new Error(e.message);onEvent?.(e);if(e.phase==='done')last=e;}}if(!last)throw new Error('O processamento terminou sem resultado.');return last;}
async function inspectVideo(url){
  const info=await backend('/youtube/inspect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url})});
  const known=[...library.values()].find(song=>song.cover===`https://i.ytimg.com/vi/${info.video_id}/hqdefault.jpg`);
  if(known)return {...info,artist:known.artist,title:known.title,identityVerified:true,identitySource:'Conferido na sua biblioteca'};
  try{const found=await backend(`/lyrics-search/identificar?artist=${encodeURIComponent(info.artist||'')}&title=${encodeURIComponent(info.title||'')}`);return identifySong(info,[...(found.found?[found]:[]),...(found.candidates||[])]);}
  catch{return {...info,identityVerified:false,identitySource:'Sugestão do vídeo'};}
}
function form(values){return{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded; charset=utf-8'},body:new URLSearchParams(values)};}
const pendingReviewsFile=path.join(data,'revisoes-pendentes.json'),pendingReviews=new Map();
let pendingReviewWrites=Promise.resolve();
function savePendingReviews(){
  const operation=pendingReviewWrites.then(async()=>{const temporary=pendingReviewsFile+'.'+randomUUID()+'.tmp';await fsp.writeFile(temporary,JSON.stringify([...pendingReviews.values()],null,2));await fsp.rename(temporary,pendingReviewsFile);});
  pendingReviewWrites=operation.catch(()=>{});return operation;
}
async function waitForLyricsReview(job,review,{artist,title,language},restored=false){
  const waiting=lyricsReviews.wait(job.id,review);
  const pendingJob={...job,status:'awaiting_lyrics',reviewAvailable:true,stage:'Letra pronta para comparar e revisar antes da sincronização',percent:null};
  pendingReviews.set(job.id,{job:pendingJob,review,artist,title,language});
  if(!restored)await savePendingReviews();
  Object.assign(job,pendingJob);broadcast();
  try{const lyrics=await waiting;pendingReviews.delete(job.id);await savePendingReviews();job.status='running';job.reviewAvailable=false;return lyrics;}
  catch(error){pendingReviews.delete(job.id);await savePendingReviews();throw error;}
}
function failImport(job,error){job.status=error.name==='AbortError'?'cancelled':'error';job.reviewAvailable=false;job.stage=String(error.message).slice(0,800);broadcast();}
async function importSong(job,input){
  const update=(stage,percent=null)=>{job.stage=stage;job.percent=percent;broadcast();};
  try{update('Iniciando processador');await ensureBackend();const setup=await backend('/setup/status');if(!setup.ready)throw new Error('Há modelos de IA ausentes. Abra o Criador de Músicas uma vez e conclua o download dos modelos.');
    update('Consultando vídeo e conferindo artista e música');const info=await inspectVideo(input.url);job.title=info.video_title;broadcast();
    update('Baixando áudio');const imported=await stream('/youtube/import-stream?video_id='+encodeURIComponent(info.video_id),e=>{if(e.percent!=null)update('Baixando áudio',e.percent);});job.session=imported.session_id;
    const artist=input.artist?.trim()||info.artist,title=input.title?.trim()||info.title,language=input.language||info.language||'pt';
    await backend(`/session/${job.session}/metadata`,{...form({artist,title,language}),method:'PATCH'});
    update('Separando voz e instrumental');await stream(`/extract-vocals-stream/${job.session}`,e=>{if(e.percent!=null)update('Separando voz e instrumental',e.percent);});
    const prepared=await prepareLyrics({manual:input.lyrics,
      search:async()=>{update('Pesquisando letra de referência na internet');return backend(`/lyrics-search/${job.session}?artist=${encodeURIComponent(artist)}&title=${encodeURIComponent(title)}`);},
      transcribe:async()=>{update('Transcrevendo o áudio para comparar com a letra');return stream(`/transcribe-stream/${job.session}?language=${encodeURIComponent(language)}&model_preset=balanced`);}
    });
    update('Comparando a letra encontrada com o áudio');
    const review={...prepared,artist,title,googleUrl:'https://www.google.com/search?q='+encodeURIComponent(`${artist} ${title} letra`)};
    job.lyricsComparison={similarity:prepared.comparison.similarity,differences:prepared.comparison.differenceCount??null,source:prepared.referenceSource};
    let lyrics=prepared.suggestedLyrics;
    if(input.reviewLyrics!==false){
      lyrics=await waitForLyricsReview(job,review,{artist,title,language});
    }
    await finishImport(job,{review,artist,title,language,lyrics,reviewed:input.reviewLyrics!==false});
  }catch(e){failImport(job,e);}
}
async function finishImport(job,{review,artist,title,language,lyrics,reviewed}){
  const update=(stage,percent=null)=>{job.stage=stage;job.percent=percent;broadcast();};
  await ensureBackend();
    await fsp.mkdir(path.join(data,'revisoes-letras'),{recursive:true});
    await fsp.writeFile(path.join(data,'revisoes-letras',job.id+'.json'),JSON.stringify({...review,finalLyrics:lyrics,reviewed},null,2));
    update('Preparando sílabas');const split=await backend('/hyphenate',form({lyrics,language}));await backend(`/lyrics/${job.session}`,form({lyrics:split.hyphenated,artist,title,language}));
    await backend(`/generate/start/${job.session}`,{method:'POST'});
    const stages={tempo:'Analisando ritmo',pitch:'Detectando melodia',align:'Sincronizando letra',notes:'Gerando notas',write:'Salvando música'};
    let result;for(let i=0;i<1800;i++){result=await backend(`/generate/result/${job.session}`);if(result.status==='ok')break;if(result.status==='error'||result.status==='cancelled')throw new Error(result.message||'Geração interrompida.');update(stages[result.progress?.step]||'Gerando música',result.progress?.percent??null);await new Promise(r=>setTimeout(r,2000));}
    if(result?.status!=='ok')throw new Error('O processamento excedeu o tempo de espera.');
    update('Adicionando à biblioteca');const parent=path.join(songRoot,'Importadas na web');await fsp.mkdir(parent,{recursive:true});
    await backend(`/export-folder/${job.session}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({folder:parent,include:{vocals:true,instrumental:true,summary:false,midi:false,video:false}})});
    await scan();job.status='done';update('Pronta para cantar',100);libraryChanged();
}
let savedReviews=[];
try{savedReviews=JSON.parse(await fsp.readFile(pendingReviewsFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
if(!Array.isArray(savedReviews))throw new Error('Arquivo de revisões pendentes inválido.');
for(const saved of savedReviews){
  if(!/^[\w-]{1,80}$/.test(saved.job?.id||'')||!/^[\w-]{1,80}$/.test(saved.job?.session||'')||!saved.review)throw new Error('Revisão pendente inválida.');
  const job={...saved.job};jobs.push(job);
  void (async()=>{try{const lyrics=await waitForLyricsReview(job,saved.review,saved,true);await finishImport(job,{...saved,lyrics,reviewed:true});}catch(error){failImport(job,error);}})();
}
const interfaces=Object.entries(os.networkInterfaces()).flatMap(([name,list])=>list.filter(i=>i.family==='IPv4'&&!i.internal&&!i.address.startsWith('169.254.')).map(i=>({name,address:i.address})));
const wifi=interfaces.filter(i=>/wi-?fi|wireless|wlan/i.test(i.name));
const ips=(wifi.length?wifi:interfaces.filter(i=>!/virtual|vethernet|bluetooth/i.test(i.name))).map(i=>`http://${i.address}:${port}/?controle=1`);
const server=http.createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost'),p=url.pathname;
  // JSON writes from other websites are rejected; only the local app controls the room.
  if(req.method==='POST') {const origin=req.headers.origin;if(origin&&origin!==`http://${req.headers.host}`)return json(res,{error:'Origem não permitida.'},403);if(!req.headers['content-type']?.includes('application/json'))return json(res,{error:'JSON esperado.'},415);}
  if(p==='/api/library'){await scan();return json(res,{songs:songs(),phoneUrls:ips,trashSupported:true,trashCount:songTrash.records.length});}
  if(p==='/api/library/trash'&&req.method==='GET')return json(res,{songs:songTrash.list()});
  if(p==='/api/library/delete'&&req.method==='POST'){
    const input=await body(req);await scan();const song=library.get(input.songId);
    if(!song)return json(res,{error:'Música não encontrada na biblioteca.'},404);
    const current=library.get(state.current),removingCurrent=current&&songKey(current)===songKey(song);
    if(removingCurrent&&state.playing)return json(res,{error:'Pause a música antes de excluí-la.'},409);
    const versions=[...catalog.values()].filter(item=>songKey(item)===songKey(song));
    const removed=await songTrash.remove(song,versions);
    const ids=new Set(versions.map(item=>item.id));state.queue=state.queue.filter(item=>!ids.has(item.songId));
    if(removingCurrent){nativeMic.stop();state.current=null;state.playing=false;state.score=0;}
    await scan();broadcast();libraryChanged();return json(res,{ok:true,removed});
  }
  if(p==='/api/library/restore'&&req.method==='POST'){
    const input=await body(req);await songTrash.restore(input.id);await scan();libraryChanged();return json(res,{ok:true});
  }
  if(p==='/api/events'){res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});res.write(`data: ${JSON.stringify(publicState())}\n\n`);clients.add(res);req.on('close',()=>clients.delete(res));return;}
  if(p==='/api/room')return json(res,publicState());
  if(p.startsWith('/api/microphone/')) {
    if(!localMicrophoneRequest(req))return json(res,{error:'O microfone nativo só pode ser controlado neste computador, pelo endereço localhost.'},403);
    if(p==='/api/microphone/devices'&&req.method==='GET')return json(res,{devices:await nativeMic.devices()});
    if(p==='/api/microphone/events'&&req.method==='GET') {
      const clientId=url.searchParams.get('clientId');if(!/^[\w-]{1,80}$/.test(clientId||''))return json(res,{error:'Sessão inválida.'},400);
      res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive'});
      const unsubscribe=nativeMic.subscribe(clientId,res);const timer=setInterval(()=>res.write(': heartbeat\n\n'),3000);
      req.on('close',()=>{clearInterval(timer);unsubscribe();});return;
    }
    if(req.method==='POST') {
      const b=await body(req);if(typeof b.clientId!=='string'||b.clientId.length>80)return json(res,{error:'Sessão inválida.'},400);
      if(p==='/api/microphone/stop'){nativeMic.stop(b.clientId);return json(res,{ok:true});}
      if(state.owner!==b.clientId)return json(res,{error:'Este player não está controlando a sala.'},409);
      if(p==='/api/microphone/start')return json(res,await nativeMic.start(b.clientId,String(b.deviceId||''),{captureOnly:!!b.captureOnly}));
      if(p==='/api/microphone/heartbeat')return json(res,{active:nativeMic.touch(b.clientId)});
    }
    return json(res,{error:'Operação inválida.'},404);
  }
  if(p==='/api/audio-status'&&req.method==='POST'){const b=await body(req);audioEvents.push({at:new Date().toISOString(),kind:String(b.kind||'').slice(0,30),state:String(b.state||'').slice(0,20),time:+b.time||0,contextTime:+b.contextTime||0,paused:!!b.paused,muted:!!b.muted,volume:+b.volume||0});audioEvents.splice(0,Math.max(0,audioEvents.length-100));return json(res,{ok:true});}
  if(p==='/api/audio-status')return json(res,{events:audioEvents});
  if(p==='/api/import/resolve'&&req.method==='POST')return json(res,resolveMediaInput((await body(req)).value));
  if(p==='/api/import/inspect'&&req.method==='POST'){
    const input=await body(req),resolved=resolveMediaInput(input.value);
    if(resolved.kind!=='video')return json(res,resolved);
    await ensureBackend();const info=await inspectVideo(resolved.url);
    return json(res,{...resolved,artist:info.artist||'',title:info.title||info.video_title||'',videoTitle:info.video_title||'',language:info.language||'pt',identityVerified:info.identityVerified,identitySource:info.identitySource});
  }
  if(p==='/api/youtube/search'&&req.method==='POST'){
    const b=await body(req),query=String(b.query||'').trim();if(query.length<2||query.length>180)throw new Error('Digite o nome da música ou artista (2 a 180 caracteres).');
    const tools=path.join(root,'dados','appdata','com.ultrastar.creator','tools','yt-dlp');const versions=(await fsp.readdir(tools)).sort().reverse();let tool;
    for(const version of versions){const candidate=path.join(tools,version,'yt-dlp.exe');if(fs.existsSync(candidate)){tool=candidate;break;}}
    if(!tool)throw new Error('A ferramenta de busca não está disponível. Adicione um link para iniciar a configuração.');
    const {stdout}=await runFile(tool,['--flat-playlist','--dump-single-json','--skip-download','--no-warnings','--playlist-end','6','--',`ytsearch6:${query}`],{windowsHide:true,timeout:120000,maxBuffer:4000000});
    const result=JSON.parse(stdout);return json(res,{results:(result.entries||[]).filter(e=>/^[\w-]{11}$/.test(e.id||'')).map(e=>({id:e.id,title:e.title||'Vídeo',artist:e.uploader||e.channel||'',seconds:e.duration||0,url:`https://www.youtube.com/watch?v=${e.id}`,cover:e.thumbnails?.find(t=>t.url?.startsWith('https://i.ytimg.com/'))?.url||`https://i.ytimg.com/vi/${e.id}/hqdefault.jpg`}))});
  }
  if(p.startsWith('/api/song/')){const id=p.split('/')[3],song=library.get(id);if(!song)return json(res,{error:'Música não encontrada.'},404);if(p.endsWith('/audio')){const file=url.searchParams.get('track')==='original'?song.original:url.searchParams.get('track')==='vocals'?song.vocals:song.audio;if(!file)return json(res,{error:'Esta faixa não está disponível.'},404);return serveFile(req,res,file,path.extname(file)==='.wav'?'audio/wav':'audio/mpeg');}return json(res,{id:song.id,title:song.title,artist:song.artist,notes:song.notes,lines:song.lines,cover:song.cover,hasOriginal:song.hasOriginal,hasVocals:song.hasVocals});}
  const reviewRoute=p.match(/^\/api\/import\/([\w-]+)\/lyrics(?:\/(compare|cancel))?$/);
  if(reviewRoute){
    const id=reviewRoute[1],review=lyricsReviews.get(id);
    if(!review)return json(res,{error:'Revisão de letra não encontrada.'},404);
    if(req.method==='GET'&&!reviewRoute[2])return json(res,review);
    if(req.method==='POST'){
      const input=await body(req);
      if(reviewRoute[2]==='compare')return json(res,compareLyrics(cleanLyrics(input.reference),review.transcription));
      if(reviewRoute[2]==='cancel'){lyricsReviews.cancel(id);return json(res,{ok:true});}
      if(!reviewRoute[2]){lyricsReviews.submit(id,input.lyrics);return json(res,{ok:true});}
    }
    return json(res,{error:'Operação inválida.'},405);
  }
  if(p==='/api/import'&&req.method==='POST'){if(jobs.some(j=>['running','awaiting_lyrics'].includes(j.status)))return json(res,{error:'Já há uma música sendo preparada. Aguarde terminar.'},409);const input=await body(req);const resolved=resolveMediaInput(input.url);if(resolved.kind!=='video')throw new Error('Esse link contém uma pesquisa. Busque na tela inicial e selecione o vídeo da música antes de importar.');input.url=resolved.url;const j={id:randomUUID(),title:input.title||'Nova música',status:'running',stage:'Na fila',percent:null};jobs.unshift(j);jobs.splice(6);for(const id of lyricsReviews.entries.keys())if(!jobs.some(job=>job.id===id))lyricsReviews.entries.delete(id);void importSong(j,input);broadcast();return json(res,j,202);}
  if(p==='/api/queue'&&req.method==='POST'){const b=await body(req);if(!library.has(b.songId))throw new Error('Música não encontrada.');if(state.queue.length>=50)throw new Error('A fila está cheia.');state.queue.push({id:randomUUID(),songId:b.songId,singer:String(b.singer||'Convidado').slice(0,40)});broadcast();return json(res,{ok:true});}
  if(p==='/api/action'&&req.method==='POST'){const b=await body(req);if(typeof b.clientId!=='string'||b.clientId.length>80)throw new Error('Sessão inválida.');const owner=state.owner===b.clientId;let resultPayload={};
    if(b.action==='claim'){if(state.owner&&!owner&&Date.now()-state.ownerSeen<20000)return json(res,{error:'Já existe um player ativo. Pause e feche a outra aba antes de abrir aqui.'},409);if(!owner)nativeMic.stop();state.owner=b.clientId;state.ownerSeen=Date.now();}
    else if(b.action==='release'){if(owner){nativeMic.stop(b.clientId);state.owner=null;state.playing=false;}}
    else if(b.action==='update'){if(owner){state.ownerSeen=Date.now();state.current=library.has(b.songId)?b.songId:null;state.playing=!!b.playing;state.time=Math.max(0,+b.time||0);state.score=Math.max(0,Math.min(10000,+b.score||0));state.singer=String(b.singer||'').slice(0,40);}}
    else if(b.action==='remove'){state.queue=state.queue.filter(q=>q.id!==b.id);}
    else if(b.action==='consume'){if(!owner)throw new Error('Abra o player no computador.');state.queue=state.queue.filter(q=>q.id!==b.id);}
    else if(['pause','skip'].includes(b.action)){for(const c of clients)c.write(`event: command\ndata: ${JSON.stringify({action:b.action})}\n\n`);}
    else if(b.action==='result'){
      if(!owner)throw new Error('Resultado sem player ativo.');const song=library.get(b.songId);
      if(!song||!Number.isFinite(b.score))throw new Error('Resultado inválido.');
      const entry={artist:song.artist,title:song.title,singer:String(b.singer||'Convidado').trim().slice(0,40)||'Convidado',score:Math.round(Math.max(0,Math.min(10000,b.score))),date:new Date().toISOString(),partial:b.partial===true};
      resultPayload=await highScores.record(entry);history.unshift(entry);history=history.slice(0,100);
      await fsp.writeFile(path.join(data,'historico.json'),JSON.stringify(history,null,2));
      if(resultPayload.newRecord)libraryChanged();
    }
    broadcast();return json(res,{ok:true,...resultPayload});}
  const staticFiles={'/':'index.html','/app.mjs':'app.mjs','/music.mjs':'music.mjs','/audio-engine.mjs':'audio-engine.mjs','/style.css':'style.css'};if(staticFiles[p])return serveFile(req,res,path.join(dir,'public',staticFiles[p]),p.endsWith('.mjs')?'text/javascript; charset=utf-8':p.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');
  json(res,{error:'Não encontrado.'},404);
}catch(e){if(!res.headersSent)json(res,{error:e.message},400);else res.end();}});
const heartbeat=setInterval(()=>{for(const c of clients)c.write(': heartbeat\n\n');},10000);heartbeat.unref();
server.listen(port,'0.0.0.0',()=>{console.log(`Sala Karaokê: http://localhost:${port}`);for(const ip of ips)console.log('Controle pelo celular:',ip);});
server.on('error',e=>{console.error(e.code==='EADDRINUSE'?`O karaokê já está aberto em http://localhost:${port}`:e);process.exit(1);});
function shutdown(){nativeMic.stop();ownedBackend?.kill();for(const c of clients)c.end();server.close(()=>process.exit());}process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
