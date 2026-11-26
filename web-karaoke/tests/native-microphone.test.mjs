import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {NativeMicrophone,parseDevices} from '../native-microphone.mjs';

const devices=[{id:'native-realtek',label:'Microfone Realtek'}];
function pcm(hz=220){const buffer=Buffer.alloc(2048);for(let i=0;i<1024;i++)buffer.writeInt16LE(Math.round(Math.sin(i/16000*2*Math.PI*hz)*16000),i*2);return buffer;}
function fakeProcess(){const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.killed=false;child.kill=()=>{child.killed=true;queueMicrotask(()=>child.emit('close',0));};return child;}
test('Device enumeration recognizes native alternatives without exposing a shell',()=>{assert.deepEqual(parseDevices('[dshow] "Camera" (video)\n[dshow] Alternative name "camera-id"\n[dshow] "Microfone Realtek" (audio)\n[dshow] Alternative name "native-realtek"\n'),devices);});
test('Native PCM split across chunks produces only pitch/level and closes the process',async()=>{
  const child=fakeProcess(),events=[];let args;
  const mic=new NativeMicrophone('ffmpeg',{listDevices:async()=>devices,spawnProcess:(file,values)=>{args=values;return child;}});
  mic.subscribe('owner',{writableLength:0,write:value=>events.push(value)});
  const opening=mic.start('owner');while(!mic.process)await Promise.resolve();
  const data=pcm();child.stdout.write(data.subarray(0,13));child.stdout.write(data.subarray(13));
  await opening;assert.ok(Math.abs(mic.latest.hz-220)<1);assert.ok(mic.latest.level>.3);
  assert.ok(args.includes('audio=native-realtek'));assert.equal(args.at(-1),'pipe:1');
  const samples=events.filter(event=>event.startsWith('event: sample'));
  assert.equal(samples.length,1);const payload=JSON.parse(samples[0].split('data: ')[1]);assert.deepEqual(Object.keys(payload),['hz','level','at']);
  assert.equal(mic.stop('other'),false);assert.equal(child.killed,false);assert.equal(mic.touch('owner'),true);
  mic.stop('owner');assert.equal(child.killed,true);assert.equal(mic.process,null);assert.equal(mic.latest,null);
});
test('Concurrent activation and canceled enumeration cannot leak a native capture',async()=>{let finish,calls=0;const mic=new NativeMicrophone('ffmpeg',{listDevices:()=>new Promise(resolve=>finish=resolve),spawnProcess:()=>{calls++;return fakeProcess();}});const opening=mic.start('a');await assert.rejects(mic.start('b'),/iniciado/);mic.stop('a');finish(devices);await assert.rejects(opening,/cancelada/);assert.equal(calls,0);});
test('Unexpected capture exit clears ownership; invalid devices never spawn',async()=>{const child=fakeProcess();let calls=0;const mic=new NativeMicrophone('ffmpeg',{listDevices:async()=>devices,spawnProcess:()=>{calls++;return child;}});await assert.rejects(mic.start('a','missing'),/disponível/);assert.equal(calls,0);const opening=mic.start('a');while(!mic.process)await Promise.resolve();child.emit('close',1);await assert.rejects(opening,/não abriu/);assert.equal(mic.owner,null);assert.equal(mic.timer,null);});
test('An abandoned native capture expires its lease',async()=>{const child=fakeProcess();const mic=new NativeMicrophone('ffmpeg',{leaseMs:20,listDevices:async()=>devices,spawnProcess:()=>child});const opening=mic.start('a');while(!mic.process)await Promise.resolve();child.stdout.write(pcm());await opening;await new Promise(resolve=>setTimeout(resolve,1100));assert.equal(child.killed,true);assert.equal(mic.owner,null);});
