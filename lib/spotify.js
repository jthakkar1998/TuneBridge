'use strict';
const {cleanTrack,matchScore}=require('./music');
async function spotifyFetch(path,token,opts={},fetchImpl=fetch){
 if(!token||token.length>4000)throw Object.assign(new Error('Connect your Spotify account first.'),{status:401});
 const u=new URL(path,'https://api.spotify.com');
 if(u.origin!=='https://api.spotify.com'||!u.pathname.startsWith('/v1/'))throw Object.assign(new Error('Invalid Spotify request'),{status:400});
 const res=await fetchImpl(u,{method:opts.method||'GET',headers:{Authorization:`Bearer ${token}`,Accept:'application/json',...(opts.body?{'Content-Type':'application/json'}:{})},body:opts.body?JSON.stringify(opts.body):undefined,signal:AbortSignal.timeout(18000)});
 const t=await res.text();let data={};try{data=t?JSON.parse(t):{}}catch{}
 if(!res.ok){const text=res.status===403?'Spotify only allows access to a playlist you own or collaborate on in developer mode.':`Spotify returned ${res.status}.`;throw Object.assign(new Error(text),{status:res.status});}
 return data;
}
function fromSpotify(song){return cleanTrack({name:song?.name,artist:song?.artists?.map(a=>a.name).join(', '),isrc:song?.external_ids?.isrc,duration:song?.duration_ms,url:song?.external_urls?.spotify,artwork:song?.album?.images?.at(-1)?.url||song?.album?.images?.[0]?.url});}
async function getSpotifyPlaylist(id,token,fetchImpl=fetch){
 const meta=await spotifyFetch(`/v1/playlists/${id}`,token,{},fetchImpl);
 const tracks=[];let offset=0;let total=1;
 while(offset<total&&tracks.length<300){
  const page=await spotifyFetch(`/v1/playlists/${id}/items?limit=50&offset=${offset}`,token,{},fetchImpl);
  if(!Array.isArray(page.items))break;
  total=page.total||0;
  for(const row of page.items){const item=row.item||row.track;if(item?.type==='track'&&!row.is_local){const tr=fromSpotify(item);if(tr)tracks.push(tr);}}
  offset+=page.items.length;if(!page.items.length)break;
 }
 if(!tracks.length)throw Object.assign(new Error('No accessible songs found. Spotify only exposes playlists you own or collaborate on in development mode.'),{status:422});
 return {title:meta.name||'Shared playlist',image:meta.images?.[0]?.url||null,description:meta.description?.replace(/<[^>]*>/g,'').slice(0,260)||'',source:'spotify',sourceUrl:meta.external_urls?.spotify||`https://open.spotify.com/playlist/${id}`,tracks,truncated:offset<total};
}
async function matchSpotify(tracks,token,fetchImpl=fetch){
 // Three concurrent requests per batch to avoid timeouts without overwhelming API quotas.
 const matches=new Array(tracks.length);let next=0;
 await Promise.all(Array.from({length:Math.min(3,tracks.length)},async()=>{
  while(next<tracks.length){
   const i=next++,source=tracks[i],t=cleanTrack(source);
   if(!t){matches[i]={status:'unmatched',name:String(source?.name||''),artist:String(source?.artist||'')};continue;}
   let candidates=[];
   if(t.isrc){const q=new URLSearchParams({q:`isrc:${t.isrc}`,type:'track',limit:'5'});const r=await spotifyFetch(`/v1/search?${q}`,token,{},fetchImpl);candidates=r.tracks?.items||[];}
   if(!candidates.length){const q=new URLSearchParams({q:`track:${t.name} artist:${t.artist.split(',')[0]}`,type:'track',limit:'10'});const r=await spotifyFetch(`/v1/search?${q}`,token,{},fetchImpl);candidates=r.tracks?.items||[];}
   const picks=candidates.map(song=>({id:song.id,track:fromSpotify(song)})).filter(c=>c.id&&c.track).sort((a,b)=>matchScore(t,b.track)-matchScore(t,a.track));
   const pick=picks[0],score=pick?matchScore(t,pick.track):0;
   matches[i]={name:t.name,artist:t.artist,status:score>=.70?'matched':score>=.52?'review':'unmatched',confidence:+score.toFixed(2),id:score>=.52?pick.id:null,matchedName:score>=.52?pick.track.name:null,matchedArtist:score>=.52?pick.track.artist:null};
  }
 }));
 return matches;
}
async function createSpotifyPlaylist(title,ids,token,fetchImpl=fetch){
 if(!ids.length)throw Object.assign(new Error('No matching songs to import.'),{status:422});
 const playlist=await spotifyFetch('/v1/me/playlists',token,{method:'POST',body:{name:title.slice(0,100),description:'Imported with TuneBridge',public:false}},fetchImpl);
 if(!playlist.id)throw Object.assign(new Error('Spotify did not return the playlist ID.'),{status:502});
 for(let i=0;i<ids.length;i+=100)await spotifyFetch(`/v1/playlists/${playlist.id}/items`,token,{method:'POST',body:{uris:ids.slice(i,i+100).map(id=>`spotify:track:${id}`)}},fetchImpl);
 return {id:playlist.id,service:'spotify',url:playlist.external_urls?.spotify||`https://open.spotify.com/playlist/${playlist.id}`};
}
module.exports={spotifyFetch,fromSpotify,getSpotifyPlaylist,matchSpotify,createSpotifyPlaylist};
