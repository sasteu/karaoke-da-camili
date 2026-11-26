import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

test('Fim da música mostra os pontos, salva o recorde e volta à biblioteca pelo botão',async()=>{
  const source=await fs.readFile(new URL('../public/app.mjs',import.meta.url),'utf8');
  const start=source.indexOf("audio.addEventListener('ended',run(async()=>{");
  const end=source.indexOf("$('play').onclick",start),nodes=new Map(),listeners={},calls=[];
  const $=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',addEventListener(type,handler){this[type]=handler;},showModal(){this.open=true;},close(){this.open=false;}});return nodes.get(id);};
  const context={$,audio:{addEventListener(type,handler){listeners[type]=handler;}},run:fn=>fn,
    resultPending:false,roundFinished:false,song:{id:'song',title:'Música',artist:'Artista',notes:[{kind:':',start:2}]},hasSung:true,scoreReferenceStart:0,
    points:()=>8123,singer:()=>'Ana',sendState:()=>calls.push('state'),stopMic:async()=>calls.push('stopMic'),owner:true,
    action:async(type,data)=>{calls.push({type,data});return {newRecord:true,record:{score:8123,singer:'Ana'}};},
    view:stage=>calls.push({stage}),refreshLibrary:async()=>calls.push('library'),toast:()=>{}};
  vm.runInNewContext(source.slice(start,end),context);
  await listeners.ended();
  assert.equal($('resultDialog').open,true);assert.equal($('resultScore').textContent,'8.123');assert.equal($('resultSinger').textContent,'Ana');
  assert.equal($('resultRecord').textContent,'Novo recorde da música!');assert.equal($('resultLibrary').disabled,false);
  const result=calls.find(call=>call.type==='result');assert.equal(result.data.score,8123);assert.equal(result.data.partial,false);
  assert.ok(calls.indexOf('stopMic')<calls.indexOf(result));assert.equal(calls.at(-1).type,'release');
  await listeners.ended();assert.equal(calls.filter(call=>call.type==='result').length,1);
  $('resultLibrary').onclick();assert.equal($('resultDialog').open,false);assert.ok(calls.some(call=>call.stage===false));assert.equal(calls.at(-1),'library');
});
