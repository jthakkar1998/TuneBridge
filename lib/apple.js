'use strict';
const {createAppleToken,cleanTrack,matchScore}=require('./music');
async function appleFetch(path, opts={}, env=process.env, fetchImpl=fetch) {
  const token=createAppleToken(env);
  if(!token) throw Object.assign(new Error('Apple Music developer credentials have not been configured.'),{status:503});
  const url=new URL(path,'https://api.music.apple.com');
  if(url.origin!=='https://api.music.apple.com'||!url.pathname.startsWith('/v1/')) throw Object.assign(new Error('Invalid Apple Music request.'),{status:400});
  const headers={Authorization:`Bearer ${token}`,Accept:'application/json',...(opts.userToken?{'Music-User-Token':opts.userToken}:{}),...(opts.body?{'Content-Type':'application/json'}:{})};
  const r=await fetchImpl(url,{method:opts.method||'GET',headers,body:opts.body?JSON.stringify(opts.body):undefined,signal:AbortSignal.timeout(16000)});
  const text=await r.text(); let json={};try{json=text?JSON.parse(text):{}}catch{}
  if(!r.ok) throw Object.assign(new Error(`Apple Music returned ${r.status}${json?.errors?.[0]?.detail ? ': '+json.errors[0].detail : ''}`),{status:r.status});
  return json;
}
function art(attributes) { return attributes?.artwork?.url?.replace('{w}','160').replace('{h}','160') || null; }
function fromApple(song) {const a=song?.attributes||{};return cleanTrack({name:a.name,artist:a.artistName,isrc:a.isrc,duration:a.durationInMillis,url:a.url,artwork:art(a)});}
async function getApplePlaylist(parsed,userToken,env=process.env,fetchImpl=fetch) {
  const sf=parsed.storefront||'us'; const isLibrary=parsed.id.startsWith('p.');
  if(isLibrary&&!userToken) throw Object.assign(new Error('This Apple Music library playlist needs the owner to connect Apple Music.'),{status:401});
  const resource=isLibrary?`/v1/me/library/playlists/${encodeURIComponent(parsed.id)}`:`/v1/catalog/${sf}/playlists/${encodeURIComponent(parsed.id)}`;
  const meta=await appleFetch(resource,{userToken},env,fetchImpl);
  const playlist=meta.data?.[0];if(!playlist) throw Object.assign(new Error('Apple Music playlist not found.'),{status:404});
  const tracks=[];let offset=0; const MAX=300;let next=`${resource}/tracks?limit=100`;
  while(next&&tracks.length<MAX){
    const page=await appleFetch(next,{userToken},env,fetchImpl);
    for(const item of (page.data||[])) { const song=fromApple(item); if(song) tracks.push(song); }
    next=page.next||null;offset++;if(offset>8)break;
  }
  if(!tracks.length) throw Object.assign(new Error('No importable songs were found in this Apple Music playlist.'),{status:422});
  return {title:playlist.attributes?.name||'Shared playlist',image:art(playlist.attributes),description:playlist.attributes?.description?.standard||'',source:'apple_music',sourceUrl:parsed.url,tracks:tracks.slice(0,MAX),truncated:!!next};
}
async function matchApple(tracks,storefront,env=process.env,fetchImpl=fetch){
 const sf=/^[a-z]{2}$/i.test(storefront||'')?storefront.toLowerCase():'us';
 const matches=new Array(tracks.length);let next=0;
 await Promise.all(Array.from({length:Math.min(4,tracks.length)},async()=>{
  while(next<tracks.length){
   const i=next++,source=tracks[i],t=cleanTrack(source);
   if(!t){matches[i]={status:'unmatched',name:String(source?.name||''),artist:String(source?.artist||'')};continue;}
   let songs=[];
   if(t.isrc){const q=new URLSearchParams({'filter[isrc]':t.isrc});try{const r=await appleFetch(`/v1/catalog/${sf}/songs?${q}`,{},env,fetchImpl);songs=r.data||[];}catch(e){if(e.status===401||e.status===503)throw e;}}
   if(!songs.length){const q=new URLSearchParams({term:`${t.name} ${t.artist}`,types:'songs',limit:'8'});const r=await appleFetch(`/v1/catalog/${sf}/search?${q}`,{},env,fetchImpl);songs=r.results?.songs?.data||[];}
   const picks=songs.map(song=>({id:song.id,track:fromApple(song)})).filter(c=>c.id&&c.track).sort((a,b)=>matchScore(t,b.track)-matchScore(t,a.track));
   const pick=picks[0],score=pick?matchScore(t,pick.track):0;
   matches[i]={name:t.name,artist:t.artist,status:score>=.70?'matched':score>=.52?'review':'unmatched',confidence:+score.toFixed(2),id:score>=.52?pick.id:null,matchedName:score>=.52?pick.track.name:null,matchedArtist:score>=.52?pick.track.artist:null};
  }
 }));
 return matches;
}
async function createApplePlaylist(title,ids,userToken,env=process.env,fetchImpl=fetch) {
  if(!userToken)throw Object.assign(new Error('Authorize Apple Music before importing.'),{status:401});
  if(!ids.length)throw Object.assign(new Error('No matched songs to import.'),{status:422});
  // Apple accepts a catalog 'songs' relationship in playlist creation. Batching keeps requests bounded.
  const created=await appleFetch('/v1/me/library/playlists',{method:'POST',userToken,body:{attributes:{name:title.slice(0,100),description:'Imported with TuneBridge'},relationships:{tracks:{data:ids.slice(0,75).map(id=>({id:String(id),type:'songs'}))}}}},env,fetchImpl);
  const id=created.data?.[0]?.id;
  if(!id)throw Object.assign(new Error('Apple Music did not return the new playlist ID. Check your library before trying again.'),{status:502});
  for(let x=75;x<ids.length;x+=75) await appleFetch(`/v1/me/library/playlists/${encodeURIComponent(id)}/tracks`,{method:'POST',userToken,body:{data:ids.slice(x,x+75).map(n=>({id:String(n),type:'songs'}))}},env,fetchImpl);
  return {id,service:'apple_music',url:null,note:'Created in your Apple Music library. Apple does not guarantee a public share URL for API-created library playlists.'};
}
module.exports={appleFetch,getApplePlaylist,matchApple,createApplePlaylist,fromApple};
