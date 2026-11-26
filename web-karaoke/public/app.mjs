import {LocalMicrophone,Player} from './audio-engine.mjs?v=native-mic-1';
import {midiFromHz,eligibleDuration,singingFrame,singingQuality,makeTestTone,songSync} from './music.mjs?v=note-roll-1';

if(new URLSearchParams(location.search).has('audio-test')) {
  await captureDiagnostic();
} else {
const $=id=>document.getElementById(id);
const audio=$('audio'),player=new Player(audio);
const remote=new URLSearchParams(location.search).get('controle')==='1';
const clientId=crypto.randomUUID();
const microphone=new LocalMicrophone(api,clientId);
microphone.onEnded=()=>{void stopMic();toast('A captura local do microfone foi encerrada.');};
document.body.classList.toggle('remote',remote);
let library=[],room={queue:[],history:[],jobs:[]},phoneUrls=[],song=null,owner=false;
let selecting=false,micBusy=false,earned=0,scoreStart=0,scoreReferenceStart=0,lastTime=0,hasSung=false;
let midi=null,scoreEnabled=false,sync=0,currentLine=-1,rows=[],lastFrame=0;
let latency=Number(localStorage.getItem('sala-latency')||100);
let libraryKey='',queueKey='',historyKey='',jobKey='',resultPending=false,roundFinished=false;
let testUrl=null,reviewingJob=null,identifyGeneration=0,deletingSong=null,trashSupported=false;
let voiceTrail=[],noteHits=new Map(),rollLow=48,rollHigh=72;
audio.volume=.75;
$('latency').value=latency;$('latencyValue').textContent=latency+' ms';
$('singer').value=localStorage.getItem('sala-singer')||'';
const singer=()=>$('singer').value.trim()||'Convidado';
const clock=t=>`${Math.floor((t||0)/60)}:${String(Math.floor((t||0)%60)).padStart(2,'0')}`;
function el(tag,className='',text=''){const node=document.createElement(tag);node.className=className;node.textContent=text;return node;}
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,6500);}
function run(fn){return (...args)=>Promise.resolve().then(()=>fn(...args)).catch(error=>toast(error.message));}
async function api(route,data){const response=await fetch('/api'+route,data?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}:{});const result=await response.json();if(!response.ok)throw new Error(result.error||'Não foi possível concluir.');return result;}
const action=(type,data={})=>api('/action',{action:type,clientId,...data});
function view(stage){$('stageView').hidden=!stage;$('libraryView').hidden=stage;$('stageTab').setAttribute('aria-pressed',String(stage));$('libraryTab').setAttribute('aria-pressed',String(!stage));window.scrollTo(0,0);currentLine=-1;}
$('stageTab').onclick=()=>view(true);$('libraryTab').onclick=$('backButton').onclick=()=>view(false);
function points(){return hasSung?Math.min(10000,Math.round(10000*earned/Math.max(.001,eligibleDuration(song?.notes||[],scoreReferenceStart)))):0;}
function resetScore(){roundFinished=false;voiceTrail=[];noteHits.clear();earned=0;hasSung=false;scoreStart=audio.currentTime;scoreReferenceStart=scoreStart+sync-latency/1000;lastTime=audio.currentTime;scoreEnabled=!!microphone.scoring;$('score').textContent='0000';$('quality').textContent=scoreEnabled?'Solte a voz':'Pronto para cantar?';}
async function refreshLibrary(){const result=await api('/library');library=result.songs;phoneUrls=result.phoneUrls;trashSupported=!!result.trashSupported;$('trashButton').hidden=!trashSupported;$('trashCount').textContent=result.trashCount||0;
  if(song&&!library.some(item=>item.id===song.id)){player.pause();void stopMic();if(owner){owner=false;void action('release').catch(()=>{});}song=null;player.songId=null;audio.removeAttribute('src');audio.load();rows=[];voiceTrail=[];noteHits.clear();earned=0;hasSung=false;scoreEnabled=false;$('songTitle').textContent='Escolha uma música';$('songArtist').textContent='KARAOKÊ EM CASA';$('score').textContent='0000';$('quality').textContent='Pronto para cantar?';$('lyricsTrack').replaceChildren(el('p','','Escolha uma música na biblioteca.'));$('lyricsTrack').style.transform='';$('backdrop').style.backgroundImage='';$('lyricCue').textContent='';$('elapsed').textContent='0:00';$('duration').textContent='0:00';}
  renderLibrary();renderRoom();}

function renderLibrary(){const query=$('filter').value.toLocaleLowerCase('pt-BR');$('songCount').textContent=library.length;$('songList').replaceChildren();
  for(const item of library.filter(s=>(s.title+' '+s.artist).toLocaleLowerCase('pt-BR').includes(query))){
    const card=el('article','song-card'),cover=el('button','cover-button');cover.setAttribute('aria-label',`Selecionar ${item.title}`);
    if(item.cover){const image=el('img');image.src=item.cover;image.alt='';image.loading='lazy';cover.append(image);}else cover.append(el('span','cover-fallback','♫'));
    cover.onclick=run(()=>remote?enqueue(item.id):choose(item.id));
    const info=el('div','song-info'),buttons=el('div','card-actions');info.append(el('strong','',item.title),el('p','',item.artist));
    const record=el('div','song-record');
    if(item.highScore){record.append(el('small','','RECORDE'),el('b','',`${item.highScore.score.toLocaleString('pt-BR')} pontos`),el('span','',`por ${item.highScore.singer}`));}else record.append(el('span','muted','Ainda sem recorde'));
    info.append(record);
    const sing=el('button','',remote?'Entrar na fila':'Cantar'),add=el('button','','＋ Fila');sing.onclick=cover.onclick;add.onclick=run(()=>enqueue(item.id));buttons.append(sing,add);if(trashSupported){const remove=el('button','song-delete','Excluir');remove.setAttribute('aria-label',`Excluir ${item.title}, ${item.artist}`);remove.onclick=()=>{deletingSong=item;$('deleteSongName').textContent=item.artist+' — '+item.title;$('deleteSongError').textContent='';$('deleteSongDialog').showModal();};buttons.append(remove);}info.append(buttons);card.append(cover,info);$('songList').append(card);
  }
  if(!$('songList').children.length)$('songList').append(el('p','empty',query?'Nenhuma música encontrada.':'Busque uma música ou cole um link no campo de busca.'));
}
async function enqueue(songId){await api('/queue',{songId,singer:singer()});toast('Música adicionada à fila.');}
function renderRoom(){
  const q=JSON.stringify([room.queue,library.map(s=>s.id)]);if(q!==queueKey){queueKey=q;$('queueCount').textContent=room.queue.length;$('queue').replaceChildren();for(const item of room.queue){const s=library.find(s=>s.id===item.songId),row=el('div','queue-item'),info=el('div'),remove=el('button','','×');remove.setAttribute('aria-label',`Remover ${s?.title||'música'} da fila`);remove.onclick=run(()=>action('remove',{id:item.id}));info.append(el('strong','',s?.title||'Música'),el('small','',item.singer));row.append(info,remove);$('queue').append(row);}if(!room.queue.length)$('queue').append(el('p','empty','A próxima pode ser sua. Adicione uma música à fila.'));}
  const h=JSON.stringify(room.history);if(h!==historyKey){historyKey=h;$('history').replaceChildren();for(const item of room.history.slice(0,5)){const row=el('div','history-item');row.append(el('b','',item.score.toLocaleString('pt-BR')),el('strong','',item.singer),el('small','',item.title));$('history').append(row);}if(!room.history.length)$('history').append(el('p','empty','Seu primeiro show aparece aqui.'));}
  const job=room.jobs?.[0],j=JSON.stringify(job);if(j!==jobKey){const previous=jobKey;jobKey=j;$('job').hidden=!job;if(job){$('job').replaceChildren(el('p','eyebrow',job.status==='done'?'PRONTA PARA CANTAR':job.status==='awaiting_lyrics'?'LETRA PARA REVISAR':job.status==='cancelled'?'IMPORTAÇÃO CANCELADA':job.status==='error'?'VERIFICAR IMPORTAÇÃO':'PREPARANDO MÚSICA'),el('h2','',job.title),el('p',job.status==='error'?'error':'muted',job.stage+(job.percent!=null&&job.status==='running'?` · ${Math.round(job.percent)}%`:'')));if(job.reviewAvailable){const review=el('button','primary review-job-button','Comparar e revisar letra');review.onclick=run(()=>openLyricsReview(job.id));$('job').append(review);}if(job.lyricsComparison?.similarity!=null)$('job').append(el('p','muted',`${job.lyricsComparison.similarity}% de semelhança textual · ${job.lyricsComparison.differences||0} trechos diferentes`));if(job.status==='done'&&previous)void refreshLibrary().catch(error=>toast(error.message));}}
}
function applyRoom(next){room=next;if(owner&&room.owner!==clientId){owner=false;player.pause();void stopMic();toast('Outro player assumiu a sala.');}renderRoom();}
const events=new EventSource('/api/events');events.onopen=()=>$('connection').textContent='Sala conectada';events.onerror=()=>$('connection').textContent='Reconectando…';events.onmessage=event=>{try{applyRoom(JSON.parse(event.data));}catch(error){console.error(error);}};
events.addEventListener('library',()=>{void refreshLibrary().catch(error=>toast(error.message));});
events.addEventListener('command',event=>{if(!owner||remote)return;const command=JSON.parse(event.data);if(command.action==='pause')player.pause();if(command.action==='skip')run(nextSong)();});
async function claim(){if(remote)throw new Error('Toque a música no computador.');await action('claim');owner=true;}
async function choose(id,autoplay=false){
  if(selecting||player.loading)return;selecting=true;
  try{player.pause();if(owner&&!microphone.active){owner=false;await action('release');}const selected=await api('/song/'+id);await player.load(id);song=selected;sync=songSync(localStorage.getItem('sala-sync-'+song.id));updateSync();resetScore();$('songTitle').textContent=song.title;$('songArtist').textContent=song.artist;$('original').disabled=!song.hasOriginal;$('backdrop').style.backgroundImage=song.cover?`url("${song.cover}")`:'';renderLines();updateTrack();view(true);if(autoplay)await play();}finally{selecting=false;}
}
async function play(){if(!song){toast('Escolha uma música na biblioteca.');view(false);return;}if(audio.ended){toast('Música encerrada. Escolha uma música na biblioteca.');return;}await claim();await player.play();sendState();}
async function nextSong(){if(remote)return action('skip');if(!room.queue.length){toast('A fila está vazia.');return;}const next=room.queue[0];await claim();$('singer').value=next.singer;await choose(next.songId,true);await action('consume',{id:next.id});}
function sendState(){if(owner&&song)void action('update',{songId:song.id,playing:!audio.paused,time:audio.currentTime,score:points(),singer:singer()}).catch(()=>{});}
setInterval(sendState,2000);
function updateTrack(){for(const track of ['instrumental','original'])$(track).setAttribute('aria-pressed',String(player.track===track));}
for(const track of ['instrumental','original'])$(track).onclick=run(async()=>{await player.switchTrack(track);lastTime=audio.currentTime;updateTrack();});
audio.addEventListener('play',()=>{$('play').textContent='Pausar';lastTime=audio.currentTime;});audio.addEventListener('pause',()=>{$('play').textContent='Reproduzir';sendState();});
audio.addEventListener('loadedmetadata',()=>{$('duration').textContent=clock(audio.duration);$('play').disabled=false;$('play').textContent='Reproduzir';});
audio.addEventListener('error',()=>toast('Não foi possível abrir o áudio da música.'));
audio.addEventListener('ended',run(async()=>{
  if(resultPending||roundFinished||!song)return;
  roundFinished=true;resultPending=true;$('play').disabled=true;$('play').textContent='Encerrada';
  const scored=hasSung,score=points(),name=singer(),finishedSong=song;
  const firstNote=song.notes.find(note=>note.kind!=='F'),partial=!firstNote||scoreReferenceStart>firstNote.start;
  $('resultScore').textContent=score.toLocaleString('pt-BR');$('resultSinger').textContent=name;
  $('resultSong').textContent=`${song.artist} — ${song.title}`;
  $('resultHint').textContent=scored?(partial?'Pontuação do trecho cantado. Cante desde o começo para disputar o recorde.':'Seus acertos, de 0 a 10.000 pontos.'):'Nenhum ponto nesta rodada. Ative o microfone e cante para pontuar.';
  $('resultRecord').textContent='';$('resultLibrary').disabled=true;$('resultLibrary').textContent='Finalizando…';$('resultDialog').showModal();
  try{
    sendState();await stopMic();
    if(scored){const result=await action('result',{songId:finishedSong.id,singer:name,score,partial});$('resultRecord').textContent=result.newRecord?'Novo recorde da música!':result.record?`Recorde: ${result.record.score.toLocaleString('pt-BR')} pontos · ${result.record.singer}`:'';}
  }catch(error){$('resultHint').textContent+=' Não foi possível salvar o resultado: '+error.message;}
  finally{if(owner){owner=false;await action('release').catch(()=>{});}resultPending=false;$('resultLibrary').disabled=false;$('resultLibrary').textContent='Voltar à biblioteca';}
}));
function returnToLibrary(){if(resultPending)return;$('resultDialog').close();view(false);void refreshLibrary().catch(error=>toast(error.message));}
$('resultLibrary').onclick=returnToLibrary;
$('resultDialog').addEventListener('cancel',event=>{event.preventDefault();returnToLibrary();});
$('play').onclick=run(()=>audio.paused?play():player.pause());$('next').onclick=run(nextSong);
$('volume').oninput=()=>audio.volume=+$('volume').value/100;
function renderLines(){rows=song.lines.map(line=>{const row=el('p');for(const note of line.notes)row.append(el('span','',note.text.replace(/^~(?=\s|$)/,'')));return row;});$('lyricsTrack').replaceChildren(...rows);currentLine=-1;}
function lyrics(time){if(!song||!rows.length)return;let index=song.lines.findLastIndex(line=>line.start<=time);index=Math.max(0,index);if(index!==currentLine){rows.forEach((row,i)=>{row.classList.toggle('current',i===index);if(i!==index)for(const span of row.children){span.className='';span.style.removeProperty('--progress');}});currentLine=index;}
  const active=rows[index];$('lyricsTrack').style.transform=`translateY(${$('lyricsViewport').clientHeight/2-active.offsetTop-active.offsetHeight/2}px)`;
  [...active.children].forEach((span,i)=>{const note=song.lines[index].notes[i];span.className=time>=note.end?'sung':time>=note.start?'active':'';if(time>=note.start&&time<note.end)span.style.setProperty('--progress',Math.round((time-note.start)/(note.end-note.start)*100)+'%');});
  const next=song.lines.find(line=>line.start>time),line=song.lines[index];
  $('lyricCue').textContent=time<song.lines[0].start?`A voz começa em ${Math.ceil(song.lines[0].start-time)} s`:time>line.end&&next?`Instrumental · próxima frase em ${Math.ceil(next.start-time)} s`:time>song.lines.at(-1).end?'Final instrumental':'';
}
function updateSync(){$('syncStatus').textContent=sync?'Ajuste desta música salvo neste navegador.':'O ajuste da letra é salvo por música neste navegador.';$('syncReset').textContent=`${sync>0?'+':''}${sync.toFixed(1).replace('.',',')} s`;lastTime=audio.currentTime;currentLine=-1;}
function setSync(value){if(!song)return;sync=songSync(value);localStorage.setItem('sala-sync-'+song.id,String(sync));updateSync();resetScore();if(audio.currentTime>2)$('syncStatus').textContent='Ajuste salvo. Pontuação reiniciada para este trecho.';}
$('later').onclick=()=>setSync(sync-.1);$('earlier').onclick=()=>setSync(sync+.1);$('syncReset').onclick=()=>setSync(0);
async function stopMic(){await microphone.close();voiceTrail=[];midi=null;scoreEnabled=false;$('captureOnly').disabled=false;$('micDevice').disabled=false;$('micButton').textContent='Ativar microfone';$('micStatus').textContent='Ative antes de começar a música.';$('pitchLabel').textContent='Microfone desligado';$('micMeter').style.width='0';$('audioDiagnostic').textContent='Microfone desligado.';}
async function populateDevices(){
  const result=await api('/microphone/devices');
  const select=$('micDevice'),previous=select.value;select.replaceChildren();
  for(const device of result.devices){const option=el('option','',device.label);option.value=device.id;select.append(option);}
  if([...select.options].some(option=>option.value===previous))select.value=previous;
  $('outputDevice').disabled=typeof audio.setSinkId!=='function';
}
async function toggleMic(){
  if(micBusy)return;micBusy=true;$('micButton').disabled=true;
  try{
    if(microphone.active){await stopMic();return;}
    if(remote||!['localhost','127.0.0.1','[::1]'].includes(location.hostname))throw new Error('Ative o microfone neste computador pelo endereço http://localhost:8787.');
    await claim();
    const captureOnly=$('captureOnly').checked;
    const result=await microphone.open($('micDevice').value,{captureOnly});
    $('captureOnly').disabled=true;$('micDevice').disabled=true;$('micButton').textContent='Desativar microfone';
    $('micStatus').textContent=captureOnly?'Captura local ativa, sem pontuação.':'Microfone do computador ativo. Cante para ver sua afinação.';
    $('audioDiagnostic').textContent=`${result.device} · captura nativa local · ${result.sampleRate} Hz`;
    resetScore();if(!audio.paused||audio.currentTime>.5)toast('Pontuação ligada a partir deste trecho.');
    reportAudio('native-mic-open');
  }catch(error){await stopMic();throw error;}
  finally{micBusy=false;$('micButton').disabled=false;}
}
$('micButton').onclick=run(toggleMic);
$('latency').oninput=()=>{$('latencyValue').textContent=$('latency').value+' ms';};$('latency').onchange=()=>{latency=+$('latency').value;localStorage.setItem('sala-latency',latency);resetScore();toast('Atraso de entrada salvo. Pontuação reiniciada para este trecho.');};
$('outputDevice').onchange=run(async()=>{await audio.setSinkId($('outputDevice').value);if(typeof $('testAudio').setSinkId==='function')await $('testAudio').setSinkId($('outputDevice').value);});
$('testSound').onclick=run(async()=>{if(!testUrl)testUrl=URL.createObjectURL(new Blob([makeTestTone()],{type:'audio/wav'}));const test=$('testAudio');test.src=testUrl;test.volume=.6;await test.play();});
const rollCanvas=$('noteCanvas'),rollContext=rollCanvas.getContext('2d');
function drawRoll(time){
  const rect=rollCanvas.getBoundingClientRect();if(!rect.width)return;
  const width=rect.width,height=rect.height,ratio=Math.min(devicePixelRatio||1,2);
  if(rollCanvas.width!==Math.round(width*ratio)||rollCanvas.height!==Math.round(height*ratio)){rollCanvas.width=Math.round(width*ratio);rollCanvas.height=Math.round(height*ratio);}
  const g=rollContext;g.setTransform(ratio,0,0,ratio,0,0);g.clearRect(0,0,width,height);
  const visible=song?.notes.filter(note=>note.end>=time-2&&note.start<=time+6&&note.kind!=='F')||[];
  const pitches=visible.map(note=>note.pitch),low=pitches.length?Math.min(...pitches)-3:48,high=pitches.length?Math.max(...pitches)+3:72;
  const middle=(low+high)/2,span=Math.max(12,high-low);rollLow+=(middle-span/2-rollLow)*.08;rollHigh+=(middle+span/2-rollHigh)*.08;
  const x=value=>width*.25+(value-time)*width/8,y=value=>height-16-(value-rollLow)/(rollHigh-rollLow)*(height-32);
  for(let i=1;i<6;i++){g.strokeStyle='#ffffff0c';g.lineWidth=1;g.beginPath();g.moveTo(0,i*height/6);g.lineTo(width,i*height/6);g.stroke();}
  g.fillStyle='#ffffff04';g.fillRect(0,0,width*.25,height);
  for(const note of visible){
    const index=song.notes.indexOf(note),hit=noteHits.get(index),quality=hit?.duration?hit.earned/hit.duration:0;
    const active=time>=note.start&&time<=note.end;
    g.fillStyle=note.end<time?(quality>=.7?'#ffadd6':quality>.1?'#e7c477':'#79546e'):'#ccadef';
    g.beginPath();g.roundRect(x(note.start),y(note.pitch)-5,Math.max(4,(note.end-note.start)*width/8),10,5);g.fill();
    if(active){g.strokeStyle='#ffffff88';g.lineWidth=1;g.stroke();}
  }
  g.strokeStyle='#ffadd688';g.lineWidth=1;g.beginPath();g.moveTo(width*.25,8);g.lineTo(width*.25,height-8);g.stroke();
  voiceTrail=voiceTrail.filter(point=>point.time>=time-2&&point.time<=time+.05);
  let previous=null;
  for(const point of voiceTrail){g.strokeStyle=point.hit?'#ffadd6':'#f8f5ff';g.lineWidth=3;g.lineCap='round';g.beginPath();if(previous&&point.time-previous.time<.25)g.moveTo(x(previous.time),y(previous.pitch));else g.moveTo(x(point.time)-1,y(point.pitch));g.lineTo(x(point.time),y(point.pitch));g.stroke();previous=point;}
  if(!song){g.fillStyle='#c3a9bf';g.font='14px system-ui';g.textAlign='center';g.fillText('Escolha uma música para ver as notas',width/2,height/2);}
}
function updateRoll(time){
  const target=song?.notes.find(note=>time>=note.start&&time<note.end&&note.kind!=='F');
  let quality=0;
  if(target&&midi!=null){quality=['R','G'].includes(target.kind)?1:singingQuality(midi,target.pitch);}
  if(microphone.scoring&&!audio.paused&&midi!=null){
    const anchor=target?.pitch??(rollLow+rollHigh)/2;
    voiceTrail.push({time,pitch:midi+Math.round((anchor-midi)/12)*12,hit:quality>=.7});
  }
  const status=!microphone.scoring?'Ative o microfone para ganhar pontos.':audio.paused?'Tudo pronto. Dê play e cante!':!target?'Instrumental':midi==null?'Cante junto':quality>=.95?'Acertou!':quality>0?'Quase!':'Acompanhe as barras';
  $('rollStatus').textContent=status;
  if(scoreEnabled&&!audio.paused)$('quality').textContent=status;
}
function tick(now){if(now-lastFrame>80){lastFrame=now;const input=microphone.read();midi=null;if(input){const hz=input.hz;midi=hz?midiFromHz(hz):null;$('micMeter').style.width=Math.min(100,input.level*500)+'%';$('pitchLabel').textContent='Microfone ativo';}else if(microphone.active){$('micMeter').style.width='0';$('pitchLabel').textContent='Aguardando sinal do microfone';}
  const time=audio.currentTime;$('elapsed').textContent=clock(time);const progress=Number.isFinite(audio.duration)&&audio.duration>0?Math.max(0,Math.min(100,time/audio.duration*100)):0;$('songProgressFill').style.width=progress+'%';$('songProgress').setAttribute('aria-valuenow',String(Math.round(progress)));$('songProgress').setAttribute('aria-valuetext',clock(time)+' de '+clock(audio.duration));lyrics(time+sync);updateRoll(time+sync-latency/1000);$('singerLabel').textContent=singer();
  if(song&&scoreEnabled&&!audio.paused&&!player.loading){const end=time+sync-latency/1000,from=Math.max(end-.2,lastTime+sync-latency/1000);if(end>=from){const result=singingFrame(song.notes,from,end,midi);earned+=result.earned;for(const match of result.matches){const hit=noteHits.get(match.index)||{earned:0,duration:0};hit.earned+=match.duration*match.quality;hit.duration+=match.duration;noteHits.set(match.index,hit);}if(midi!=null&&result.matches.length)hasSung=true;}$('score').textContent=String(points()).padStart(4,'0');}lastTime=time;
}drawRoll(audio.currentTime+sync-latency/1000);requestAnimationFrame(tick);}requestAnimationFrame(tick);
function reportAudio(kind='heartbeat'){void api('/audio-status',{kind,state:microphone.active?'native-microphone':'native',time:audio.currentTime,contextTime:0,paused:audio.paused,muted:audio.muted,volume:audio.volume}).catch(()=>{});}
setInterval(()=>{if(microphone.active||!audio.paused)reportAudio();},3000);
$('filter').oninput=renderLibrary;$('singer').oninput=()=>localStorage.setItem('sala-singer',$('singer').value);
$('fullscreen').onclick=run(()=>document.fullscreenElement?document.exitFullscreen():$('stageView').requestFullscreen());
$('deleteSongForm').onsubmit=async event=>{event.preventDefault();if(!deletingSong)return;const button=event.submitter;button.disabled=true;$('deleteSongError').textContent='';try{await api('/library/delete',{songId:deletingSong.id});$('deleteSongDialog').close();deletingSong=null;await refreshLibrary();toast('Música excluída. Você pode restaurar pela lixeira.');}catch(error){$('deleteSongError').textContent=error.message;}finally{button.disabled=false;}};
async function renderTrash(){
  const result=await api('/library/trash');$('trashList').replaceChildren();
  for(const item of result.songs){const row=el('div','trash-song'),info=el('div'),restore=el('button','','Restaurar');info.append(el('strong','',item.title),el('small','',item.artist));restore.setAttribute('aria-label',`Restaurar ${item.title}`);restore.onclick=async()=>{restore.disabled=true;$('trashError').textContent='';try{await api('/library/restore',{id:item.id});await refreshLibrary();await renderTrash();toast('Música restaurada na biblioteca.');}catch(error){$('trashError').textContent=error.message;restore.disabled=false;}};row.append(info,restore);$('trashList').append(row);}
  if(!result.songs.length)$('trashList').append(el('p','empty','Sua lixeira está vazia.'));
}
$('trashButton').onclick=run(async()=>{$('trashError').textContent='';await renderTrash();$('trashDialog').showModal();});
for(const close of document.querySelectorAll('.close'))close.onclick=()=>close.closest('dialog').close();
function openImport(result={}){identifyGeneration++;$('identifyStatus').textContent='Confira artista e música antes de preparar.';$('identifyImport').disabled=false;$('youtubeUrl').value=result.url||'';$('importArtist').value=result.artist||'';$('importTitle').value=result.title||'';$('importLyrics').value='';$('importError').textContent='';updateGoogleSearch();$('importDialog').showModal();if(result.url)void identifyImport().catch(error=>{$('identifyStatus').textContent=error.message;});}

$('importForm').onsubmit=async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;$('importError').textContent='';try{await api('/import',{url:$('youtubeUrl').value,artist:$('importArtist').value,title:$('importTitle').value,language:$('language').value,lyrics:$('importLyrics').value,reviewLyrics:$('reviewLyrics').checked});$('importDialog').close();toast('Preparação iniciada. Você pode acompanhar ao lado.');}catch(error){$('importError').textContent=error.message;}finally{button.disabled=false;}};
$('searchForm').onsubmit=async event=>{event.preventDefault();let query=$('youtubeQuery').value.trim();$('searchButton').disabled=true;$('searchStatus').textContent='Buscando no YouTube…';$('searchResults').replaceChildren();try{if(/^(?:https?:\/\/|(?:www\.)?(?:google\.|youtube\.|youtu\.be))/i.test(query)){const resolved=await api('/import/resolve',{value:query});if(resolved.kind==='video'){openImport({url:resolved.url});$('searchStatus').textContent='Confira a identificação do vídeo antes de importar.';return;}query=resolved.query;$('youtubeQuery').value=query;}const result=await api('/youtube/search',{query});$('searchStatus').textContent=result.results.length?'Confira a gravação antes de adicionar.':'Nenhum resultado encontrado.';for(const item of result.results){const row=el('article','search-result'),image=el('img'),info=el('div'),link=el('a','','Ouvir no YouTube'),add=el('button','','Adicionar');image.src=item.cover;image.alt='';image.loading='lazy';link.href=item.url;link.target='_blank';link.rel='noopener';info.append(el('strong','',item.title),el('p','',`${item.artist} · ${clock(item.seconds)}`),link);add.onclick=()=>openImport(item);row.append(image,info,add);$('searchResults').append(row);}}catch(error){$('searchStatus').textContent=error.message;}finally{$('searchButton').disabled=false;}};
async function identifyImport(){
  const value=$('youtubeUrl').value.trim();if(!value)return;
  const generation=++identifyGeneration,artistBefore=$('importArtist').value,titleBefore=$('importTitle').value;
  $('identifyImport').disabled=true;$('importForm').querySelector('[type=submit]').disabled=true;$('identifyStatus').textContent='Consultando dados da música…';
  try{
    const result=await api('/import/inspect',{value});if(generation!==identifyGeneration)return;
    if(result.kind==='search'){$('importDialog').close();view(false);$('youtubeQuery').value=result.query;$('searchForm').requestSubmit();toast('Selecione o vídeo da gravação para continuar.');return;}
    $('youtubeUrl').value=result.url;
    if($('importArtist').value===artistBefore)$('importArtist').value=result.artist;
    if($('importTitle').value===titleBefore)$('importTitle').value=result.title;
    if([...$('language').options].some(option=>option.value===result.language))$('language').value=result.language;
    updateGoogleSearch();$('identifyStatus').textContent=result.identityVerified?result.identitySource+'. Confira a versão da gravação.':'Não consegui confirmar os nomes no catálogo. Confira artista e música; use Inverter se estiverem trocados.';
  }finally{if(generation===identifyGeneration){$('identifyImport').disabled=false;$('importForm').querySelector('[type=submit]').disabled=false;}}
}
$('importDialog').addEventListener('close',()=>{identifyGeneration++;$('identifyImport').disabled=false;$('importForm').querySelector('[type=submit]').disabled=false;});
$('swapIdentity').onclick=()=>{const artist=$('importArtist').value;$('importArtist').value=$('importTitle').value;$('importTitle').value=artist;updateGoogleSearch();};
$('identifyImport').onclick=run(identifyImport);$('youtubeUrl').addEventListener('change',()=>{void identifyImport().catch(error=>{$('identifyStatus').textContent=error.message;});});
function updateGoogleSearch(){const query=[$('importArtist').value,$('importTitle').value,'letra'].filter(Boolean).join(' ');$('googleImportSearch').href='https://www.google.com/search?q='+encodeURIComponent(query);}
$('importArtist').addEventListener('input',updateGoogleSearch);$('importTitle').addEventListener('input',updateGoogleSearch);$('importDialog').addEventListener('toggle',updateGoogleSearch);
function renderComparison(comparison){
  $('lyricsDifferences').replaceChildren();
  if(!comparison.compared){$('comparisonSummary').textContent=comparison.reason;return;}
  $('comparisonSummary').textContent=`${comparison.similarity}% de semelhança textual. ${comparison.differenceCount} trechos diferentes. Acentos, maiúsculas e pontuação são ignorados na comparação.`;
  if(!comparison.differenceCount){$('lyricsDifferences').append(el('p','muted','As palavras coincidem nas duas versões. Confira a ordem e as repetições da gravação.'));return;}
  for(const difference of comparison.differences){const row=el('div','lyric-difference'),versions=el('div','difference-versions');row.append(el('small','',`Próximo de: ${difference.before||'(início)'} … ${difference.after||'(fim)'}`));versions.append(el('p','','Referência: '+(difference.reference||'(trecho ausente)')),el('p','','Transcrição: '+(difference.transcription||'(trecho ausente)')));row.append(versions);$('lyricsDifferences').append(row);}
  if(comparison.truncated)$('lyricsDifferences').append(el('p','muted','Mostrando os primeiros 100 trechos. As versões completas estão acima.'));
}
async function openLyricsReview(id){
  const review=await api('/import/'+id+'/lyrics');reviewingJob=id;
  $('lyricsReviewSong').textContent=review.artist+' — '+review.title;
  $('lyricsReviewWarnings').textContent=review.warnings.join(' ');
  $('referenceLabel').textContent='Referência: '+review.referenceSource;
  $('referenceLyrics').value=review.reference;$('transcribedLyrics').value=review.transcription;$('finalLyrics').value=review.suggestedLyrics;
  $('useReference').disabled=!review.reference;$('useTranscription').disabled=!review.transcription;
  $('googleReviewSearch').href=review.googleUrl;$('lyricsReviewError').textContent='';renderComparison(review.comparison);$('lyricsReviewDialog').showModal();
}
$('referenceLyrics').oninput=()=>$('useReference').disabled=!$('referenceLyrics').value.trim();
$('useReference').onclick=()=>$('finalLyrics').value=$('referenceLyrics').value;
$('useTranscription').onclick=()=>$('finalLyrics').value=$('transcribedLyrics').value;
$('compareLyrics').onclick=async()=>{const button=$('compareLyrics');button.disabled=true;try{renderComparison(await api('/import/'+reviewingJob+'/lyrics/compare',{reference:$('referenceLyrics').value}));}catch(error){$('lyricsReviewError').textContent=error.message;}finally{button.disabled=false;}};
$('lyricsReviewForm').onsubmit=async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;$('lyricsReviewError').textContent='';try{await api('/import/'+reviewingJob+'/lyrics',{lyrics:$('finalLyrics').value});$('lyricsReviewDialog').close();toast('Letra escolhida. A sincronização vai continuar.');}catch(error){$('lyricsReviewError').textContent=error.message;}finally{button.disabled=false;}};
$('cancelLyricsImport').onclick=run(async()=>{await api('/import/'+reviewingJob+'/lyrics/cancel',{});$('lyricsReviewDialog').close();toast('Importação cancelada.');});
$('phoneButton').onclick=()=>{$('phoneLinks').replaceChildren();for(const url of phoneUrls){const link=el('a','',url);link.href=url;link.target='_blank';link.rel='noopener';$('phoneLinks').append(link);}if(!phoneUrls.length)$('phoneLinks').append(el('p','','Conecte o computador à rede Wi-Fi e reinicie o servidor.'));$('phoneDialog').showModal();};
if(remote){$('micButton').disabled=true;$('phoneButton').hidden=true;}
window.addEventListener('pagehide',()=>{player.pause();void microphone.close();$('testAudio').pause();if(testUrl)URL.revokeObjectURL(testUrl);events.close();if(owner)void fetch('/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'release',clientId}),keepalive:true});});
try{await refreshLibrary();}catch(error){toast(error.message);}
if(!remote)void populateDevices().catch(error=>{$('audioDiagnostic').textContent=error.message;});

}

async function captureDiagnostic() {
  document.title='Teste isolado de áudio — Sala';
  document.body.innerHTML=`<main style="display:block;max-width:850px;margin:auto"><p class="eyebrow">DIAGNÓSTICO LOCAL</p><h1>Som + microfone</h1><p>Este teste usa somente o player nativo e a captura do navegador. Não inicia análise de voz, pontuação, fila ou troca de saída.</p><section class="panel"><label>Música<select id="testSong"></select></label><audio id="minimalPlayer" controls style="width:100%;margin:1.5rem 0" preload="metadata"></audio><label>Modo de captura<select id="captureMode"><option value="default">Padrão do navegador</option><option value="raw">Sem cancelamento de eco, redução de ruído ou ganho automático</option></select></label><div style="display:flex;gap:1rem;margin:1.5rem 0;flex-wrap:wrap"><button class="primary" id="captureStart">Ligar microfone</button><button id="captureStop" disabled>Desligar microfone</button></div><p id="captureState" role="status">Microfone desligado.</p><pre id="captureDetails" style="white-space:pre-wrap;overflow-wrap:anywhere"></pre></section><p>Toque a música, ligue o microfone e observe se o som continua por 20 segundos. Compare os dois modos com o microfone desligado entre eles.</p><p>Feche outras abas do karaokê para não misturar as músicas. Faça a mesma comparação no Chrome e no Edge.</p><a href="/">Voltar ao karaokê</a></main>`;
  const find=id=>document.getElementById(id),music=find('minimalPlayer');
  let capture=null,pending=false,closed=false;
  const stop=()=>{capture?.getTracks().forEach(track=>track.stop());capture=null;find('captureStart').disabled=pending;find('captureStop').disabled=true;find('captureMode').disabled=pending;find('captureState').textContent='Microfone desligado.';};
  find('captureStart').onclick=async()=>{
    if(pending||capture)return;pending=true;find('captureStart').disabled=true;find('captureMode').disabled=true;find('captureState').textContent='Aguardando microfone…';
    try {
      const raw=find('captureMode').value==='raw';
      const acquired=await navigator.mediaDevices.getUserMedia({audio:raw?{echoCancellation:false,noiseSuppression:false,autoGainControl:false}:true,video:false});
      if(closed){acquired.getTracks().forEach(track=>track.stop());return;}
      capture=acquired;find('captureStop').disabled=false;find('captureState').textContent='Microfone ligado. O som da música continua?';
      const track=capture.getAudioTracks()[0],settings=track.getSettings();
      find('captureDetails').textContent=JSON.stringify({contextoSeguro:isSecureContext,microfone:track.label,sampleRate:settings.sampleRate,echoCancellation:settings.echoCancellation,noiseSuppression:settings.noiseSuppression,autoGainControl:settings.autoGainControl},null,2);
      track.addEventListener('ended',stop,{once:true});
    }catch(error){find('captureState').textContent=error.name+': '+error.message;find('captureStart').disabled=false;find('captureMode').disabled=false;}
    finally{pending=false;}
  };
  find('captureStop').onclick=stop;
  window.addEventListener('pagehide',()=>{closed=true;music.pause();capture?.getTracks().forEach(track=>track.stop());});
  try {
    const response=await fetch('/api/library');if(!response.ok)throw new Error('Biblioteca indisponível.');const result=await response.json();
    for(const song of result.songs){const option=document.createElement('option');option.value=song.id;option.textContent=song.artist+' — '+song.title;find('testSong').append(option);}
    const load=()=>{music.src='/api/song/'+encodeURIComponent(find('testSong').value)+'/audio?track=instrumental';music.load();};
    find('testSong').onchange=load;if(result.songs.length)load();
  }catch(error){find('captureState').textContent=error.message;}
}
