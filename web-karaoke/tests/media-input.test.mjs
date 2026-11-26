import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveMediaInput} from '../media-input.mjs';
const id='8zsZ3Ql8x7o',canonical='https://www.youtube.com/watch?v='+id;
test('YouTube links are normalized to the complete video without playlist/time parameters',()=>{for(const url of ['https://youtu.be/'+id+'?t=20','https://music.youtube.com/watch?v='+id,'https://www.youtube.com/shorts/'+id,'https://www.youtube.com/watch?v='+id+'&list=radio&t=161'])assert.equal(resolveMediaInput(url).url,canonical);});
test('Google result redirects unwrap only recognized video destinations',()=>{assert.equal(resolveMediaInput('https://www.google.com/url?q='+encodeURIComponent(canonical)).url,canonical);assert.throws(()=>resolveMediaInput('https://www.google.com/url?url='+encodeURIComponent('http://127.0.0.1/private')),/outra página/);});
test('A Google search becomes a visible search query instead of inventing artist/title',()=>{assert.deepEqual(resolveMediaInput('https://www.google.com.br/search?q=Detonautas+Outro+Lugar+letra'),{kind:'search',query:'Detonautas Outro Lugar',fromGoogle:true});assert.equal(resolveMediaInput('Detonautas Outro Lugar').kind,'search');});
test('Unsupported pages, unsafe schemes and non-video YouTube links are rejected',()=>{for(const value of ['javascript:alert(1)','https://google.com.evil.example/search?q=music','https://www.youtube.com/playlist?list=example','https://www.google.com/'])assert.throws(()=>resolveMediaInput(value));});
