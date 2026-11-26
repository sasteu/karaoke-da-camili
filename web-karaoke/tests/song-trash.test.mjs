import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('Songs can be removed, stay deleted across restart and be restored without changing media files',async t=>{
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'sala-trash-test-'));
  t.after(async()=>{assert.equal(path.dirname(path.resolve(temporary)),path.resolve(os.tmpdir()));assert.ok(path.basename(temporary).startsWith('sala-trash-test-'));await fs.rm(temporary,{recursive:true,force:true});});
  const songs=path.join(temporary,'songs'),data=path.join(temporary,'data');
  const chart='#TITLE:Teste da lixeira\n#ARTIST:Autor\n#BPM:120\n#MP3:audio.mp3\n: 0 8 0 teste\nE\n';
  for(const folder of ['a','b']){await fs.mkdir(path.join(songs,folder),{recursive:true});await fs.writeFile(path.join(songs,folder,'song.txt'),chart);await fs.writeFile(path.join(songs,folder,'audio.mp3'),Buffer.from('original-media-bytes'));}
  const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),port=18791;
  let child;
  async function stop(){if(child&&child.exitCode===null){const closed=new Promise(resolve=>child.once('exit',resolve));child.kill();await closed;}}
  t.after(stop);
  async function start(){child=spawn(process.execPath,['server.mjs'],{cwd:root,windowsHide:true,env:{...process.env,KARAOKE_PORT:String(port),KARAOKE_DATA_DIR:data,KARAOKE_SONGS_DIR:songs},stdio:'pipe'});let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);for(let i=0;i<50&&!output.includes('Sala Karaokê:');i++)await new Promise(resolve=>setTimeout(resolve,50));assert.ok(output.includes('Sala Karaokê:'),output);}
  await start();const base=`http://127.0.0.1:${port}`,get=async route=>(await fetch(base+route)).json(),post=(route,value,headers={})=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(value)});
  const initial=await get('/api/library');assert.equal(initial.songs.length,1);assert.equal(initial.trashSupported,true);const song=initial.songs[0];assert.equal('fingerprint' in song,false);
  await post('/api/queue',{songId:song.id,singer:'Pessoa'});await post('/api/action',{action:'claim',clientId:'owner'});await post('/api/action',{action:'update',clientId:'owner',songId:song.id,playing:true});
  assert.equal((await post('/api/library/delete',{songId:song.id})).status,409);
  await post('/api/action',{action:'update',clientId:'owner',songId:song.id,playing:false});
  assert.equal((await post('/api/library/delete',{songId:song.id},{Origin:'https://other.example'})).status,403);
  assert.equal((await post('/api/library/delete',{songId:song.id})).status,200);
  assert.equal((await get('/api/library')).songs.length,0);assert.equal((await get('/api/room')).queue.length,0);assert.equal((await get('/api/room')).current,null);
  assert.equal((await fetch(base+'/api/song/'+song.id+'/audio')).status,404);
  const trash=await get('/api/library/trash');assert.equal(trash.songs.length,1);assert.equal('versions' in trash.songs[0],false);
  for(const folder of ['a','b']){assert.equal(await fs.readFile(path.join(songs,folder,'song.txt'),'utf8'),chart);assert.equal(await fs.readFile(path.join(songs,folder,'audio.mp3'),'utf8'),'original-media-bytes');}
  await stop();await start();assert.equal((await get('/api/library')).songs.length,0);assert.equal((await get('/api/library/trash')).songs.length,1);
  // A genuinely changed import at the same path should be visible, while old duplicates stay hidden.
  await fs.writeFile(path.join(songs,'a','song.txt'),chart.replace('0 teste','0 nova versão'));
  assert.equal((await get('/api/library')).songs.length,1);
  assert.equal((await post('/api/library/restore',{id:trash.songs[0].id})).status,200);
  assert.equal((await get('/api/library')).songs.length,1);assert.equal((await get('/api/library/trash')).songs.length,0);
  assert.ok((await fs.readFile(path.join(songs,'a','song.txt'),'utf8')).includes('nova versão'));
});
