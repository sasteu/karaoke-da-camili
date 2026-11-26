import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {HighScores} from '../high-scores.mjs';

test('Recordes mantêm o maior resultado completo e o autor após reiniciar',async t=>{
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'sala-record-test-'));
  t.after(async()=>{assert.equal(path.dirname(path.resolve(temporary)),path.resolve(os.tmpdir()));assert.ok(path.basename(temporary).startsWith('sala-record-test-'));await fs.rm(temporary,{recursive:true,force:true});});
  const file=path.join(temporary,'recordes.json'),song={artist:'Artista',title:'Música'},scores=new HighScores(file);
  await scores.load([{...song,singer:'Antigo',score:400}]);
  assert.equal(scores.best(song).singer,'Antigo');
  assert.equal((await scores.record({...song,singer:'Trecho',score:10000,partial:true})).newRecord,false);
  await Promise.all([scores.record({...song,singer:'Ana',score:8000}),scores.record({...song,singer:'Beto',score:7000})]);
  assert.equal((await scores.record({...song,singer:'Empate',score:8000})).newRecord,false);
  const restarted=new HighScores(file);await restarted.load([]);
  assert.equal(restarted.best(song).score,8000);assert.equal(restarted.best(song).singer,'Ana');
  assert.equal(restarted.best({artist:'Outro',title:'Música'}),null);
});
