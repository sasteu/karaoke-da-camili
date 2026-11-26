import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {detectPitch} from './public/music.mjs';

export function parseDevices(stderr) {
  return [...stderr.matchAll(/"([^"\r\n]+)" \(audio\)\r?\n[^\r\n]*Alternative name "([^"\r\n]+)"/g)]
    .map(match=>({id:match[2],label:match[1]}));
}

// PCM stays in process memory; subscribers receive only pitch and input level.
export class NativeMicrophone {
  constructor(executable,{spawnProcess=spawn,listDevices=null,leaseMs=12000}={}) {
    this.executable=executable;this.spawnProcess=spawnProcess;this.deviceProvider=listDevices;
    this.process=null;this.owner=null;this.device=null;this.listeners=new Map();this.leaseMs=leaseMs;
    this.timer=null;this.lastSeen=0;this.latest=null;this.generation=0;
  }
  async devices() {
    if(this.deviceProvider)return this.deviceProvider();
    let stderr='';
    try{const result=await promisify(execFile)(this.executable,['-hide_banner','-list_devices','true','-f','dshow','-i','dummy'],{windowsHide:true,timeout:6000,maxBuffer:100000});stderr=result.stderr;}
    catch(error){stderr=error.stderr||'';}
    const devices=parseDevices(stderr);
    if(!devices.length)throw new Error('Não encontrei uma entrada de microfone nativa no computador.');
    return devices;
  }
  subscribe(owner,response) {
    if(!this.listeners.has(owner))this.listeners.set(owner,new Set());
    this.listeners.get(owner).add(response);
    response.write(`event: state\ndata: ${JSON.stringify({active:this.owner===owner&&!!this.process,device:this.device?.label})}\n\n`);
    return ()=>{this.listeners.get(owner)?.delete(response);if(!this.listeners.get(owner)?.size)this.listeners.delete(owner);};
  }
  emit(owner,event,data) {
    for(const response of this.listeners.get(owner)||[]) {
      // Drop a frame rather than buffering voice-derived data for a slow client.
      if(!response.destroyed&&response.writableLength<16000)response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  }
  touch(owner) {if(this.owner!==owner||!this.process)return false;this.lastSeen=Date.now();return true;}
  async start(owner,deviceId='',{captureOnly=false}={}) {
    if(this.process)throw new Error('O microfone já está ativo. Desative antes de tentar novamente.');
    // Reserve ownership before asynchronous enumeration to reject concurrent opens.
    if(this.owner)throw new Error('O microfone está sendo iniciado.');this.owner=owner;const generation=++this.generation;
    try {
      const devices=await this.devices();
      if(this.owner!==owner||generation!==this.generation)throw new Error('Ativação cancelada.');
      const device=deviceId?devices.find(item=>item.id===deviceId):devices[0];
      if(!device)throw new Error('Selecione um microfone disponível.');
      this.device=device;this.lastSeen=Date.now();
      const child=this.spawnProcess(this.executable,['-hide_banner','-loglevel','error','-f','dshow','-audio_buffer_size','50','-i',`audio=${device.id}`,'-vn','-ac','1','-ar','16000','-f','s16le','pipe:1'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
      this.process=child;
      let pending=Buffer.alloc(0),errorText='',ready=false;
      await new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>{reject(new Error('O microfone não entregou áudio. Feche outros gravadores e tente novamente.'));},8000);
        const fail=error=>{clearTimeout(timeout);reject(error);};
        child.stderr.on('data',chunk=>{errorText=(errorText+chunk.toString()).slice(-2000);});
        child.once('error',error=>{fail(new Error('Não foi possível iniciar a captura nativa: '+error.message));if(this.process===child)this.stop(owner);});
        child.once('close',()=>{if(!ready)fail(new Error('A captura nativa não abriu o microfone. '+errorText.slice(-500)));if(this.process===child){this.process=null;this.stop(owner);}});
        child.stdout.on('data',chunk=>{
          if(this.process!==child)return;
          if(!ready){ready=true;clearTimeout(timeout);this.emit(owner,'state',{active:true,device:device.label});resolve();}
          pending=Buffer.concat([pending,chunk]);
          while(pending.length>=2048){
            const samples=new Float32Array(1024);let energy=0;
            for(let i=0;i<samples.length;i++){const value=pending.readInt16LE(i*2)/32768;samples[i]=value;energy+=value*value;}
            pending=pending.subarray(2048);
            const frame={hz:captureOnly?null:detectPitch(samples,16000),level:Math.sqrt(energy/samples.length),at:Date.now()};
            this.latest=frame;this.emit(owner,'sample',frame);
          }
        });
      });
      if(this.process!==child)throw new Error('Ativação cancelada.');
      this.timer=setInterval(()=>{if(Date.now()-this.lastSeen>this.leaseMs)this.stop(owner);},1000);this.timer.unref();
      return {active:true,device:device.label,sampleRate:16000};
    } catch(error) {if(this.owner===owner&&generation===this.generation)this.stop(owner);throw error;}
  }
  stop(owner=this.owner) {
    if(owner!==this.owner)return false;
    this.generation++;
    const previous=this.owner,child=this.process;this.process=null;this.owner=null;this.device=null;this.latest=null;
    clearInterval(this.timer);this.timer=null;
    if(child)child.kill();
    if(previous)this.emit(previous,'state',{active:false});
    return true;
  }
}
