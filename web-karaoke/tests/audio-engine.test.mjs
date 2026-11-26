import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Microphone,Player} from '../public/audio-engine.mjs';

class Node {
  constructor(){this.connections=[];}
  connect(node){this.connections.push(node);}
  disconnect(){this.disconnected=true;}
  getFloatTimeDomainData(samples){samples.fill(.1);}
}
class Context {
  constructor(...args){assert.equal(args.length,0,'Use the device rate, not a forced sample rate');this.state='suspended';this.sampleRate=44100;this.destination={};this.source=new Node();this.analysis=new Node();}
  createMediaStreamSource(){return this.source;}
  createAnalyser(){return this.analysis;}
  createGain(){throw new Error('Microphone must never have a speaker branch');}
  createMediaElementSource(){throw new Error('Music must never enter the capture graph');}
  async resume(){this.state='running';}
  async close(){this.state='closed';}
}
function stream(){const track={stopped:false,stop(){this.stopped=true;}};return{track,getTracks:()=>[track]};}

test('Microphone uses browser defaults and an analyser with no output connection',async()=>{let constraints;const capture=stream(),mic=new Microphone({Context,devices:{async getUserMedia(options){constraints=options;return capture;}}});await mic.open();assert.deepEqual(constraints,{audio:true,video:false});const context=mic.context;assert.deepEqual(context.source.connections,[context.analysis]);assert.deepEqual(context.analysis.connections,[]);assert.equal(mic.read().sampleRate,44100);assert.ok(mic.read().samples[0]>.09);await mic.close();assert.equal(capture.track.stopped,true);assert.equal(context.state,'closed');assert.equal(mic.read(),null);});
test('Capture-only mode creates no AudioContext and releases the previous analysis',async()=>{const captures=[],mic=new Microphone({Context,devices:{async getUserMedia(){const capture=stream();captures.push(capture);return capture;}}});await mic.open();const previous=mic.context;await mic.open('',{captureOnly:true});assert.equal(previous.state,'closed');assert.equal(captures[0].track.stopped,true);assert.equal(mic.context,null);assert.equal(mic.read(),null);await mic.close();assert.equal(captures[1].track.stopped,true);});
test('Permission refusal leaves no resources and canceled grants stop their tracks',async()=>{const denied=new Microphone({Context,devices:{async getUserMedia(){throw new DOMException('Denied','NotAllowedError');}}});await assert.rejects(denied.open(),{name:'NotAllowedError'});assert.equal(denied.context,null);let grant;const capture=stream(),mic=new Microphone({Context,devices:{getUserMedia(){return new Promise(resolve=>grant=resolve);}}});const opening=mic.open();while(!grant)await Promise.resolve();await mic.close();grant(capture);await assert.rejects(opening,{name:'AbortError'});assert.equal(capture.track.stopped,true);assert.equal(mic.context,null);});
test('Concurrent activation retains only the latest capture',async()=>{let calls=0;const mic=new Microphone({Context,devices:{async getUserMedia(){calls++;return stream();}}});const first=mic.open(),second=mic.open();await assert.rejects(first,{name:'AbortError'});await second;assert.equal(calls,1);await mic.close();});
test('Analysis failure releases the capture',async()=>{class Broken extends Context{async resume(){throw new Error('device failed');}}const capture=stream(),mic=new Microphone({Context:Broken,devices:{async getUserMedia(){return capture;}}});await assert.rejects(mic.open(),/device failed/);assert.equal(capture.track.stopped,true);assert.equal(mic.context,null);});
class Audio extends EventTarget {
  constructor(){super();this.paused=true;this.currentTime=0;this.duration=180;this.plays=0;}
  load(){queueMicrotask(()=>this.dispatchEvent(new Event('loadedmetadata')));}
  async play(){this.paused=false;this.plays++;}
  pause(){this.paused=true;}
}
test('Track switching preserves playback position and paused/playing state',async()=>{const audio=new Audio(),player=new Player(audio);await player.load('song');assert.equal(audio.src,'/api/song/song/audio?track=instrumental');audio.currentTime=35;await player.play();await player.switchTrack('original');assert.equal(audio.currentTime,35);assert.equal(audio.paused,false);assert.equal(player.track,'original');player.pause();audio.currentTime=42;await player.switchTrack('instrumental');assert.equal(audio.currentTime,42);assert.equal(audio.paused,true);});
test('Microphone lifecycle does not invoke any playback operation',async()=>{const audio=new Audio(),player=new Player(audio),mic=new Microphone({Context,devices:{async getUserMedia(){return stream();}}});await player.load('song');await player.play();audio.currentTime=30;const plays=audio.plays;await mic.open();await mic.close();assert.equal(audio.paused,false);assert.equal(audio.plays,plays);assert.equal(audio.currentTime,30);});
