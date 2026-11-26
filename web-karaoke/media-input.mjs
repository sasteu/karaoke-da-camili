const youtubeHosts=new Set(['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','youtu.be']);
const googleHosts=new Set(['google.com','www.google.com','google.com.br','www.google.com.br','google.pt','www.google.pt']);
export function resolveMediaInput(value,depth=0) {
  const text=String(value||'').trim();
  if(!text||text.length>5000||depth>3)throw new Error('Informe um nome de música ou um link válido.');
  let url;
  try{url=new URL(text);}catch{if(/^[\w.-]+\.(?:com|com\.br|be)\//i.test(text))return resolveMediaInput('https://'+text,depth+1);if(text.length>180)throw new Error('A busca deve ter até 180 caracteres.');return {kind:'search',query:text};}
  if(!['https:','http:'].includes(url.protocol))throw new Error('Use um link HTTP ou HTTPS do Google ou YouTube.');
  if(googleHosts.has(url.hostname)) {
    if(url.pathname==='/url') {const target=url.searchParams.get('url')||url.searchParams.get('q');if(target&&/^https?:\/\//i.test(target))return resolveMediaInput(target,depth+1);}
    const query=url.searchParams.get('q');
    if(query){if(/^https?:\/\//i.test(query))return resolveMediaInput(query,depth+1);const cleaned=query.replace(/\b(letra|lyrics)\b/gi,' ').replace(/\s+/g,' ').trim();if(cleaned.length<2||cleaned.length>180)throw new Error('Não consegui obter o nome da música nessa pesquisa.');return {kind:'search',query:cleaned,fromGoogle:true};}
    throw new Error('Esse link do Google não contém o nome da música. Cole a pesquisa completa ou um link do YouTube.');
  }
  if(youtubeHosts.has(url.hostname)) {
    const id=url.hostname==='youtu.be'?url.pathname.slice(1).split('/')[0]:url.searchParams.get('v')||url.pathname.match(/^\/(?:shorts|embed)\/([\w-]+)/)?.[1];
    if(!/^[\w-]{11}$/.test(id||''))throw new Error('Cole o link de um vídeo específico do YouTube.');
    return {kind:'video',id,url:'https://www.youtube.com/watch?v='+id};
  }
  throw new Error('Esse link é de outra página. Use o vídeo do YouTube ou cole o nome da música na busca.');
}
