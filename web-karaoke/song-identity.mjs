const normalize=value=>String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\b(?:official|video|clip|clipe|audio|lyrics|lyric|oficial|hd|hq|vevo)\b/g,' ').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
function similarity(left,right){const a=normalize(left),b=normalize(right);if(!a||!b)return 0;if(a===b)return 1;const x=new Set(a.split(' ')),y=new Set(b.split(' '));return 2*[...x].filter(word=>y.has(word)).length/(x.size+y.size);}
export function identifySong(suggestion,candidates=[]) {
  const matches=[];
  for(const candidate of candidates){
    if(!candidate.artist||!candidate.track)continue;
    const forward=[similarity(candidate.artist,suggestion.artist),similarity(candidate.track,suggestion.title)];
    const reverse=[similarity(candidate.artist,suggestion.title),similarity(candidate.track,suggestion.artist)];
    const scores=(forward[0]+forward[1]>=reverse[0]+reverse[1])?forward:reverse;
    if(Math.min(...scores)<.75||(scores[0]+scores[1])/2<.85)continue;
    matches.push(candidate);
  }
  const identities=new Set(matches.map(item=>normalize(item.artist)+'\0'+normalize(item.track)));
  if(identities.size!==1)return {...suggestion,identityVerified:false,identitySource:'Sugestão do vídeo'};
  matches.sort((a,b)=>Math.abs((a.duration??suggestion.duration??0)-(suggestion.duration??0))-Math.abs((b.duration??suggestion.duration??0)-(suggestion.duration??0)));
  return {...suggestion,artist:matches[0].artist,title:matches[0].track,identityVerified:true,identitySource:'Conferido no LRCLIB'};
}
