export function parseSong(text) {
  const headers = {}, notes = [], lines = []; let line = [];
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (raw.startsWith('#')) { const i = raw.indexOf(':'); if(i > 0) headers[raw.slice(1,i).toUpperCase()] = raw.slice(i+1).trim(); continue; }
    if (/^P\d/.test(raw)) throw new Error('Duetos ainda não são suportados nesta versão.');
    if (raw.startsWith('-') || raw === 'E') { if(line.length) lines.push(line); line=[]; continue; }
    const m = raw.match(/^([:*FRG])\s+(-?\d+)\s+(\d+)\s+(-?\d+)\s(.*)$/);
    if (m) { const n = {beat:+m[2],beats:+m[3],pitch:+m[4]+60,text:m[5],kind:m[1],line:lines.length}; if(n.beats>0){ notes.push(n); line.push(n); } }
  }
  if (line.length) lines.push(line);
  const bpm=+headers.BPM?.replace(',','.'); if(!bpm || !notes.length) throw new Error('Arquivo sem notas válidas.');
  if(headers.RELATIVE==='YES') throw new Error('Músicas com tempos relativos ainda não são suportadas.');
  const unit=60/(bpm*4), gap=(+headers.GAP||0)/1000;
  notes.forEach(n=>{n.start=gap+n.beat*unit;n.end=n.start+n.beats*unit;});
  return {headers,notes,lines:lines.map(ns=>({start:ns[0].start,end:Math.max(...ns.map(n=>n.end)),notes:ns,text:ns.map(n=>n.text.replace(/^~(?=\s|$)/,'')).join('').trim()}))};
}
export function detectPitch(samples, sampleRate) {
  let energy=0,mean=0; for(const s of samples)mean+=s;mean/=samples.length;
  for(const s of samples)energy+=(s-mean)**2;
  if(Math.sqrt(energy/samples.length)<.008)return null;
  const min=Math.floor(sampleRate/1000),max=Math.min(Math.floor(sampleRate/65),samples.length/2|0), scores=new Float32Array(max+1);
  for(let lag=min;lag<=max;lag++){let a=0,b=0;for(let i=0;i<samples.length-max;i++){const x=samples[i]-mean,y=samples[i+lag]-mean;a+=x*y;b+=x*x+y*y;}scores[lag]=b?2*a/b:0;}
  // Earliest strong peak avoids selecting subharmonics of a sung note.
  let best=0;for(let lag=min+1;lag<max;lag++)if(scores[lag]>scores[lag-1]&&scores[lag]>=scores[lag+1])best=Math.max(best,scores[lag]);
  if(best<.72)return null;
  for(let lag=min+1;lag<max;lag++)if(scores[lag]>=Math.max(.72,best*.92)&&scores[lag]>scores[lag-1]&&scores[lag]>=scores[lag+1]){
    const l=scores[lag-1],c=scores[lag],r=scores[lag+1],d=l-2*c+r,offset=d?.5*(l-r)/d:0;
    return sampleRate/(lag+offset);
  }return null;
}
export const midiFromHz = hz=>69+12*Math.log2(hz/440);
export function noteName(midi) {
  if(!Number.isFinite(midi))return '—';
  const rounded=Math.round(midi),names=['Dó','Dó♯','Ré','Ré♯','Mi','Fá','Fá♯','Sol','Sol♯','Lá','Lá♯','Si'];
  return names[((rounded%12)+12)%12]+(Math.floor(rounded/12)-1);
}
export function pitchFeedback(midi,target) {
  if(!Number.isFinite(target))return {cents:null,message:'Aguarde a próxima nota',state:'waiting'};
  if(!Number.isFinite(midi))return {cents:null,message:'Solte a voz',state:'waiting'};
  const cents=100*(((midi-target+6)%12+12)%12-6);
  return {cents,message:Math.abs(cents)<=25?'Na nota!':cents<0?'Suba um pouco':'Desça um pouco',state:Math.abs(cents)<=25?'correct':'adjust'};
}
export function songSync(value) {const number=Number(value);return Number.isFinite(number)?Math.round(Math.max(-10,Math.min(10,number))*10)/10:0;}
export function matchQuality(midi,target,tolerance=1) {if(midi==null)return 0;const d=Math.abs(((midi-target+6)%12+12)%12-6);return d<tolerance?1-d/tolerance:0;}
export function eligibleDuration(notes,from=0) {return notes.reduce((s,n)=>s+(n.kind==='F'?0:Math.max(0,n.end-Math.max(n.start,from))*(n.kind==='*'||n.kind==='G'?2:1)),0);}
export function scoreFrame(notes,from,to,midi,tolerance=1) {
  let earned=0;for(const n of notes){const d=Math.max(0,Math.min(to,n.end)-Math.max(from,n.start));if(!d||n.kind==='F')continue;const q=n.kind==='R'||n.kind==='G'?(midi==null?0:1):matchQuality(midi,n.pitch,tolerance);earned+=d*q*(n.kind==='*'||n.kind==='G'?2:1);}return earned;
}
// Home karaoke: full credit near the note, partial credit farther out.
export function singingQuality(midi,target) {
  if(!Number.isFinite(midi)||!Number.isFinite(target))return 0;
  const distance=Math.abs(((midi-target+6)%12+12)%12-6);
  return distance<=.75?1:Math.max(0,1-(distance-.75)/1.25);
}
export function singingFrame(notes,from,to,midi) {
  let earned=0;const matches=[];
  if(to<=from)return {earned,matches};
  for(let index=0;index<notes.length;index++) {
    const note=notes[index],start=Math.max(from,note.start),end=Math.min(to,note.end),duration=end-start;
    if(duration<=0||note.kind==='F')continue;
    let quality=['R','G'].includes(note.kind)?(Number.isFinite(midi)?1:0):singingQuality(midi,note.pitch);
    // During a transition, allow 120 ms to move between adjacent notes.
    // Time is still awarded only inside the original note, never in rests.
    const middle=(start+end)/2;
    for(const neighbor of [notes[index-1],notes[index+1]]) {
      if(!neighbor||['F','R','G'].includes(neighbor.kind))continue;
      if(middle>=neighbor.start-.12&&middle<=neighbor.end+.12)quality=Math.max(quality,singingQuality(midi,neighbor.pitch));
    }
    earned+=duration*quality*(['*','G'].includes(note.kind)?2:1);
    matches.push({index,duration,quality});
  }
  return {earned,matches};
}

// Music stays on native HTMLAudio playback. The input context never owns it.
export function makeTestTone(sampleRate=48000,seconds=.65){
  const frames=Math.round(sampleRate*seconds),bytes=new Uint8Array(44+frames*2),v=new DataView(bytes.buffer);
  const str=(offset,text)=>{for(let i=0;i<text.length;i++)v.setUint8(offset+i,text.charCodeAt(i));};
  str(0,'RIFF');v.setUint32(4,36+frames*2,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,sampleRate,true);v.setUint32(28,sampleRate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,frames*2,true);
  for(let i=0;i<frames;i++){const t=i/sampleRate,envelope=Math.min(1,t/.025,(seconds-t)/.08);v.setInt16(44+i*2,Math.round(32767*.3*Math.max(0,envelope)*Math.sin(2*Math.PI*660*t)),true);}return bytes;
}
