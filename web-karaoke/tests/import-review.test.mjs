import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

test('Import searches before transcribing, waits for review and synchronizes only the chosen text',async t=>{
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'sala-lyrics-test-'));
  t.after(async()=>{assert.equal(path.dirname(path.resolve(temporary)),path.resolve(os.tmpdir()));assert.ok(path.basename(temporary).startsWith('sala-lyrics-test-'));await fs.rm(temporary,{recursive:true,force:true});});
  const calls=[];let synchronized='',generations=0;
  const processor=http.createServer(async(req,res)=>{
    const route=new URL(req.url,'http://localhost').pathname;calls.push(route);
    const chunks=[];for await(const chunk of req)chunks.push(chunk);const raw=Buffer.concat(chunks).toString();
    const json=value=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
    const event=value=>{res.writeHead(200,{'Content-Type':'text/event-stream'});res.end('data: '+JSON.stringify({phase:'done',...value})+'\n\n');};
    if(route==='/api/health')return json({ok:true});
    if(route==='/api/setup/status')return json({ready:true});
    if(route==='/api/youtube/inspect')return json({video_id:'testVideo01',video_title:'Autor — Teste',artist:'Autor',title:'Teste',language:'pt'});
    if(route==='/api/youtube/import-stream')return event({session_id:'test-session'});
    if(route==='/api/session/test-session/metadata')return json({ok:true});
    if(route==='/api/extract-vocals-stream/test-session')return event({});
    if(route==='/api/lyrics-search/test-session')return json({found:true,text:'um caminho azul',artist:'Autor',track:'Teste'});
    if(route==='/api/transcribe-stream/test-session')return event({text:'um caminho escuro'});
    if(route==='/api/hyphenate')return json({hyphenated:new URLSearchParams(raw).get('lyrics')});
    if(route==='/api/lyrics/test-session'){synchronized=new URLSearchParams(raw).get('lyrics');return json({ok:true});}
    if(route==='/api/generate/start/test-session'){generations++;return json({ok:true});}
    if(route==='/api/generate/result/test-session')return json({status:'ok'});
    if(route==='/api/export-folder/test-session')return json({ok:true});
    res.writeHead(404);res.end();
  });
  await new Promise(resolve=>processor.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>processor.close(resolve)));
  const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),port=18789;
  let child;
  async function stopWeb(){if(child&&child.exitCode===null){const closed=new Promise(resolve=>child.once('exit',resolve));child.kill();await closed;}}
  t.after(stopWeb);
  async function startWeb(){
    child=spawn(process.execPath,['server.mjs'],{cwd:root,windowsHide:true,env:{...process.env,KARAOKE_PORT:String(port),KARAOKE_BACKEND_URL:`http://127.0.0.1:${processor.address().port}`,KARAOKE_DATA_DIR:path.join(temporary,'data'),KARAOKE_SONGS_DIR:path.join(temporary,'songs')},stdio:'pipe'});
    let output='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>output+=data);
    for(let i=0;i<50&&!output.includes('Sala Karaokê:');i++)await new Promise(resolve=>setTimeout(resolve,50));assert.ok(output.includes('Sala Karaokê:'),output);
  }
  await startWeb();
  const base=`http://127.0.0.1:${port}`,get=async route=>(await fetch(base+route)).json(),post=(route,data)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  const waitFor=async status=>{for(let i=0;i<100;i++){const room=await get('/api/room');if(room.jobs[0]?.status===status)return room.jobs[0];if(room.jobs[0]?.status==='error')assert.fail(room.jobs[0].stage);await new Promise(resolve=>setTimeout(resolve,25));}assert.fail('Import did not reach '+status);};
  const response=await post('/api/import',{url:'https://youtu.be/testVideo01',reviewLyrics:true});assert.equal(response.status,202);const job=await response.json();
  await waitFor('awaiting_lyrics');assert.equal(generations,0);assert.ok(calls.indexOf('/api/lyrics-search/test-session')<calls.indexOf('/api/transcribe-stream/test-session'));
  await stopWeb();await startWeb();await waitFor('awaiting_lyrics');assert.equal(calls.filter(route=>route==='/api/transcribe-stream/test-session').length,1);
  const review=await get('/api/import/'+job.id+'/lyrics');assert.equal(review.reference,'um caminho azul');assert.equal(review.transcription,'um caminho escuro');assert.equal(review.comparison.editCount,1);
  assert.equal((await post('/api/import',{url:'https://youtu.be/testVideo01'})).status,409);
  const comparison=await post('/api/import/'+job.id+'/lyrics/compare',{reference:'um caminho escuro'});assert.equal((await comparison.json()).similarity,100);
  assert.equal((await post('/api/import/'+job.id+'/lyrics',{lyrics:' '})).status,400);assert.equal(generations,0);
  assert.equal((await post('/api/import/'+job.id+'/lyrics',{lyrics:'texto corrigido para esta versão'})).status,200);
  await waitFor('done');assert.equal(generations,1);assert.equal(synchronized,'texto corrigido para esta versão');
  const audit=JSON.parse(await fs.readFile(path.join(temporary,'data','revisoes-letras',job.id+'.json'),'utf8'));assert.equal(audit.reviewed,true);assert.equal(audit.finalLyrics,synchronized);
  const second=await post('/api/import',{url:'https://youtu.be/testVideo01'});const cancelled=await second.json();await waitFor('awaiting_lyrics');
  assert.equal((await post('/api/import/'+cancelled.id+'/lyrics/cancel',{})).status,200);await waitFor('cancelled');assert.equal(generations,1);
});
