import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {songKey} from './song-trash.mjs';

function valid(entry){return entry&&typeof entry.artist==='string'&&typeof entry.title==='string'&&Number.isFinite(entry.score)&&!entry.partial;}
export class HighScores {
  constructor(file){this.file=file;this.records=new Map();this.pending=Promise.resolve();}
  best(song){const record=this.records.get(songKey(song));return record?{score:record.score,singer:record.singer,date:record.date}:null;}
  merge(entry){
    if(!valid(entry))return false;
    const key=songKey(entry),score=Math.max(0,Math.min(10000,Math.round(entry.score))),previous=this.records.get(key);
    if(previous&&previous.score>=score)return false;
    this.records.set(key,{artist:entry.artist,title:entry.title,singer:String(entry.singer||'Convidado').trim().slice(0,40)||'Convidado',score,date:entry.date||new Date().toISOString()});return true;
  }
  async save(){const temporary=this.file+'.'+randomUUID()+'.tmp';await fs.mkdir(path.dirname(this.file),{recursive:true});await fs.writeFile(temporary,JSON.stringify([...this.records.values()],null,2));await fs.rename(temporary,this.file);}
  async load(history=[]){
    try{const records=JSON.parse(await fs.readFile(this.file,'utf8'));if(!Array.isArray(records))throw new Error('Arquivo de recordes inválido.');for(const record of records)this.merge(record);}
    catch(error){if(error.code!=='ENOENT')throw error;}
    let migrated=false;for(const entry of history)migrated=this.merge(entry)||migrated;
    if(migrated)await this.save();
  }
  record(entry){
    const operation=this.pending.then(async()=>{
      const key=songKey(entry),previous=this.records.get(key);
      const newRecord=this.merge(entry);
      if(newRecord)try{await this.save();}catch(error){if(previous)this.records.set(key,previous);else this.records.delete(key);throw error;}
      return {newRecord,record:this.best(entry)};
    });
    this.pending=operation.catch(()=>{});return operation;
  }
}
