// Local capture bypasses browser getUserMedia on affected Windows systems.
export class LocalMicrophone {
  constructor(request,clientId,{Events=globalThis.EventSource}={}) {
    this.request=request;this.clientId=clientId;this.Events=Events;
    this.active=false;this.scoring=false;this.latest=null;this.events=null;this.timer=null;this.onEnded=()=>{};
  }
  async open(deviceId='',{captureOnly=false}={}) {
    this.events=new this.Events('/api/microphone/events?clientId='+encodeURIComponent(this.clientId));
    this.events.addEventListener('sample',event=>{this.latest={...JSON.parse(event.data),received:Date.now()};});
    this.events.addEventListener('state',event=>{if(this.active&&!JSON.parse(event.data).active){void this.close();this.onEnded();}});
    try {
      const result=await this.request('/microphone/start',{clientId:this.clientId,deviceId,captureOnly});
      this.active=true;this.scoring=!captureOnly;
      this.timer=setInterval(()=>{void this.request('/microphone/heartbeat',{clientId:this.clientId}).then(result=>{if(!result.active&&this.active){void this.close();this.onEnded();}}).catch(()=>{});},3000);
      return result;
    } catch(error) {await this.close();throw error;}
  }
  read() {return this.active&&this.latest&&Date.now()-this.latest.received<500?this.latest:null;}
  async close() {
    const wasOpen=this.active||!!this.events;this.active=false;this.scoring=false;this.latest=null;
    clearInterval(this.timer);this.timer=null;this.events?.close();this.events=null;
    if(wasOpen)await this.request('/microphone/stop',{clientId:this.clientId}).catch(()=>{});
  }
}

// Legacy browser capture is kept only for independent diagnostic tests.
export class Microphone {
  constructor({devices=globalThis.navigator?.mediaDevices, Context=globalThis.AudioContext}={}) {
    this.devices=devices; this.Context=Context; this.stream=null; this.context=null;
    this.source=null; this.analyser=null; this.samples=null; this.generation=0;
  }
  async open(deviceId='', {captureOnly=false}={}) {
    const closing=this.close();
    const generation=this.generation;
    await closing;
    if(generation!==this.generation)throw new DOMException('Ativação cancelada.','AbortError');
    const stream=await this.devices.getUserMedia({audio:deviceId?{deviceId:{exact:deviceId}}:true,video:false});
    if(generation!==this.generation) {stream.getTracks().forEach(t=>t.stop()); throw new DOMException('Ativação cancelada.','AbortError');}
    this.stream=stream;
    try {
      if(!captureOnly) {
        this.context=new this.Context();
        this.source=this.context.createMediaStreamSource(stream);
        this.analyser=this.context.createAnalyser(); this.analyser.fftSize=2048;
        this.source.connect(this.analyser);
        // AnalyserNode works with its output unconnected.
        this.samples=new Float32Array(this.analyser.fftSize);
        await this.context.resume();
      }
      if(generation!==this.generation)throw new DOMException('Ativação cancelada.','AbortError');
      return this;
    } catch(error) {if(generation===this.generation)await this.close(); throw error;}
  }
  read() {
    if(!this.analyser||this.context?.state!=='running')return null;
    this.analyser.getFloatTimeDomainData(this.samples);
    return {samples:this.samples,sampleRate:this.context.sampleRate};
  }
  async close() {
    this.generation++;
    this.stream?.getTracks().forEach(t=>t.stop());
    this.source?.disconnect(); this.analyser?.disconnect();
    const context=this.context;
    this.stream=null; this.context=null; this.source=null; this.analyser=null; this.samples=null;
    if(context&&context.state!=='closed')await context.close();
  }
}

export class Player {
  constructor(element) {this.element=element;this.track='instrumental';this.songId=null;this.loading=false;}
  async load(songId,track='instrumental',position=0) {
    if(this.loading)throw new Error('Aguarde o áudio carregar.');
    this.loading=true;
    try {
      await new Promise((resolve,reject)=>{
        const cleanup=()=>{clearTimeout(timeout);this.element.removeEventListener('loadedmetadata',ready);this.element.removeEventListener('error',fail);};
        const ready=()=>{cleanup();resolve();};
        const fail=()=>{cleanup();reject(new Error('Não foi possível carregar o áudio.'));};
        const timeout=setTimeout(fail,15000);
        this.element.addEventListener('loadedmetadata',ready,{once:true});
        this.element.addEventListener('error',fail,{once:true});
        this.element.src=`/api/song/${encodeURIComponent(songId)}/audio?track=${track}`;
        this.element.load();
      });
      this.songId=songId; this.track=track;
      this.element.currentTime=Math.max(0,Math.min(position,this.element.duration||0));
    } finally {this.loading=false;}
  }
  play() {return this.element.play();}
  pause() {this.element.pause();}
  async switchTrack(track) {
    if(this.loading||!this.songId||track===this.track)return;
    const playing=!this.element.paused,position=this.element.currentTime;
    await this.load(this.songId,track,position);
    if(playing)await this.play();
  }
}
