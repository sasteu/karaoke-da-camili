export function cleanLyrics(value) {
  return String(value||'').replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n')
    .split('\n').map(line=>line.replace(/\[\d+:\d+(?:\.\d+)?\]/g,'').trim()).join('\n')
    .replace(/\n{3,}/g,'\n\n').trim();
}
const normalize=word=>word.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{N}]/gu,'');
function words(text) {
  return cleanLyrics(text).replace(/^\s*\[[^\]\n]+\]\s*$/gm,'').split(/\s+/)
    .map(original=>({original,key:normalize(original)})).filter(word=>word.key);
}

// Textual similarity is not a confidence score about which lyrics are correct.
export function compareLyrics(reference,transcription) {
  const left=words(reference),right=words(transcription),n=left.length,m=right.length;
  const base={referenceWords:n,transcriptionWords:m};
  if(!n||!m)return {...base,compared:false,similarity:null,differences:[],reason:!n?'Nenhuma letra de referência disponível.':'Nenhuma transcrição disponível.'};
  if((n+1)*(m+1)>6000000)return {...base,compared:false,similarity:null,differences:[],reason:'Texto muito longo para comparar automaticamente. Revise as versões completas.'};
  const width=m+1,matrix=new Uint16Array((n+1)*width);
  for(let i=0;i<=n;i++)matrix[i*width]=i;
  for(let j=0;j<=m;j++)matrix[j]=j;
  for(let i=1;i<=n;i++)for(let j=1;j<=m;j++)matrix[i*width+j]=Math.min(matrix[(i-1)*width+j]+1,matrix[i*width+j-1]+1,matrix[(i-1)*width+j-1]+(left[i-1].key===right[j-1].key?0:1));
  const edits=[];let i=n,j=m;
  while(i||j){
    if(i&&j&&left[i-1].key===right[j-1].key){edits.push({type:'equal',left:left[--i].original,right:right[--j].original});}
    else if(i&&j&&matrix[i*width+j]===matrix[(i-1)*width+j-1]+1){edits.push({type:'change',left:left[--i].original,right:right[--j].original});}
    else if(i&&(!j||matrix[i*width+j]===matrix[(i-1)*width+j]+1)){edits.push({type:'change',left:left[--i].original,right:''});}
    else {edits.push({type:'change',left:'',right:right[--j].original});}
  }
  edits.reverse();const differences=[];
  for(let k=0;k<edits.length;k++){
    if(edits[k].type==='equal')continue;
    const start=k,ref=[],heard=[];
    while(k<edits.length&&edits[k].type!=='equal'){if(edits[k].left)ref.push(edits[k].left);if(edits[k].right)heard.push(edits[k].right);k++;}
    differences.push({reference:ref.join(' '),transcription:heard.join(' '),before:edits.slice(Math.max(0,start-3),start).map(edit=>edit.left||edit.right).join(' '),after:edits.slice(k,k+3).map(edit=>edit.left||edit.right).join(' ')});
  }
  return {...base,compared:true,similarity:Math.round(100*(1-matrix[n*width+m]/Math.max(n,m))),editCount:matrix[n*width+m],differenceCount:differences.length,differences:differences.slice(0,100),truncated:differences.length>100};
}

export async function prepareLyrics({manual='',search,transcribe}) {
  const warnings=[];let online=null,transcription='';
  try{const result=await search();if(result?.found&&result.text)online=result;}catch{warnings.push('A busca de letra na internet não respondeu. Você pode consultar o Google e colar a letra na revisão.');}
  try{transcription=cleanLyrics((await transcribe())?.text);}catch{warnings.push('Não foi possível transcrever o áudio. Confira a letra de referência antes de continuar.');}
  const reference=cleanLyrics(manual||online?.text);
  if(!reference&&!transcription)throw new Error('Não encontrei letra nem consegui transcrever o áudio. Tente novamente informando a letra.');
  return {reference,transcription,online,warnings,suggestedLyrics:reference||transcription,comparison:compareLyrics(reference,transcription),referenceSource:manual?'Letra informada por você':online?'LRCLIB':'Sem referência encontrada'};
}

export class LyricsReviews {
  constructor(){this.entries=new Map();}
  wait(id,data){
    if(this.entries.has(id))throw new Error('Esta revisão já existe.');
    return new Promise((resolve,reject)=>this.entries.set(id,{...data,status:'waiting',resolve,reject}));
  }
  get(id){const entry=this.entries.get(id);if(!entry)return null;const {resolve,reject,...data}=entry;return data;}
  submit(id,text){
    const entry=this.entries.get(id);if(!entry||entry.status!=='waiting')throw new Error('Esta letra não está aguardando revisão.');
    const lyrics=cleanLyrics(text);if(!lyrics||lyrics.length>30000)throw new Error('Informe uma letra de 1 a 30.000 caracteres.');
    entry.status='approved';entry.finalLyrics=lyrics;entry.resolve(lyrics);delete entry.resolve;delete entry.reject;
    return lyrics;
  }
  cancel(id){const entry=this.entries.get(id);if(!entry||entry.status!=='waiting')throw new Error('Esta importação não está aguardando revisão.');entry.status='cancelled';const error=new Error('Importação cancelada antes de sincronizar a letra.');error.name='AbortError';entry.reject(error);delete entry.resolve;delete entry.reject;}
}
