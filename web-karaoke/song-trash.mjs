import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

export const songKey=song=>(song.artist+'\0'+song.title).normalize('NFKC').toLocaleLowerCase('pt-BR');

// Reversible library deletion. Media files stay in place; only exact versions
// are hidden, so importing a changed version does not resurrect an old copy.
export class SongTrash {
  constructor(file){this.file=file;this.records=[];this.hidden=new Set();this.pending=Promise.resolve();}
  async load(){try{const records=JSON.parse(await fs.readFile(this.file,'utf8'));if(!Array.isArray(records)||records.some(record=>!record.id||!Array.isArray(record.versions)))throw new Error('Lixeira de músicas inválida.');this.records=records;this.reindex();}catch(error){if(error.code!=='ENOENT')throw error;}}
  reindex(){this.hidden=new Set(this.records.flatMap(record=>record.versions.map(version=>version.songId+'\0'+version.fingerprint)));}
  has(song){return this.hidden.has(song.id+'\0'+song.fingerprint);}
  list(){return this.records.map(({versions,...record})=>record);}
  async mutate(change){
    const operation=this.pending.then(async()=>{
      const {records,result}=change(this.records);
      await fs.mkdir(path.dirname(this.file),{recursive:true});
      const temporary=this.file+'.'+randomUUID()+'.tmp';
      await fs.writeFile(temporary,JSON.stringify(records,null,2),'utf8');await fs.rename(temporary,this.file);
      this.records=records;this.reindex();return result;
    });
    this.pending=operation.catch(()=>{});return operation;
  }
  remove(song,versions){return this.mutate(records=>{
    const current=versions.filter(version=>!this.has(version));
    if(!current.length)throw new Error('Esta música já está na lixeira.');
    const record={id:randomUUID(),title:song.title,artist:song.artist,deletedAt:new Date().toISOString(),versions:current.map(version=>({songId:version.id,fingerprint:version.fingerprint}))};
    return {records:[record,...records],result:{id:record.id,title:record.title,artist:record.artist}};
  });}
  restore(id){return this.mutate(records=>{if(!records.some(record=>record.id===id))throw new Error('Música não encontrada na lixeira.');return {records:records.filter(record=>record.id!==id),result:{ok:true}};});}
}
