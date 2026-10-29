'use strict';
const {cleanTrack,parseMusicUrl}=require('./music');

// Optional adapter for MusicAPI's documented public catalog APIs. It is not a
// bypass of Spotify authorization: use only if provider terms and rights permit.
// Service credentials are *never* sent to the browser.
function hasPublicProvider(env=process.env){return Boolean(env.MUSICAPI_CLIENT_ID);}
function authHeader(env){
 if(!env.MUSICAPI_CLIENT_ID)throw Object.assign(new Error('Public playlist reading is not configured. Connect the source account for a playlist you own, or configure an approved public playlist provider.'),{status:503,code:'PUBLIC_PROVIDER_NOT_CONFIGURED'});
 if(env.MUSICAPI_CLIENT_SECRET)return `Basic ${Buffer.from(`${env.MUSICAPI_CLIENT_ID}:${env.MUSICAPI_CLIENT_SECRET}`).toString('base64')}`;
 return `Token ${env.MUSICAPI_CLIENT_ID}`;
}
async function providerCall(endpoint,payload,env=process.env,fetchImpl=fetch){
 const res=await fetchImpl(`https://api.musicapi.com${endpoint}`,{method:'POST',headers:{Authorization:authHeader(env),'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(30000)});
 const json=await res.json().catch(()=>({}));
 if(!res.ok){
  const code=res.status===402?'PROVIDER_BILLING':res.status===401||res.status===403?'PROVIDER_AUTH':'PROVIDER_ERROR';
  const msg=res.status===402?'Playlist provider billing is not active.':res.status===401||res.status===403?'Public playlist provider credentials were rejected.':res.status===429?'Playlist provider rate limit reached.':`Public playlist provider returned ${res.status}.`;
  throw Object.assign(new Error(msg),{status:res.status===429?429:502,code});
 }
 return json;
}
function mapPublicTrack(track){
 if(!track||track.isAvailable===false)return null;
 const artist=Array.isArray(track.artists)?track.artists.map(x=>x?.name).filter(Boolean).join(', '):'';
 return cleanTrack({name:track.name,artist,isrc:track.isrc,duration:track.duration,artwork:track.imageUrl,url:null});
}
async function getPublicPlaylist(url,env=process.env,fetchImpl=fetch){
 const parsed=parseMusicUrl(url);
 if(!parsed||parsed.type!=='playlist')throw Object.assign(new Error('Paste a valid Spotify or Apple Music playlist URL.'),{status:400});
 if(!hasPublicProvider(env))authHeader(env);
 const serviceId=parsed.service==='spotify'?'spotify':'appleMusic';
 const sourceUrl=parsed.url;
 let name=parsed.service==='spotify'?'Spotify playlist':'Apple Music playlist',image=null,description='';
 // Inspect is best-effort; the contents endpoint is the authoritative source.
 try{
  const info=await providerCall('/public/inspect/url',{url:sourceUrl},env,fetchImpl);
  if(info.status==='success'&&info.type==='playlist'){
   name=String(info.data?.name||name).slice(0,100);
   image=/^https:\/\//.test(info.data?.imageUrl||'')?info.data.imageUrl:null;
  }
 }catch(e){if(e.code==='PROVIDER_BILLING'||e.code==='PROVIDER_AUTH')throw e;}
 const tracks=[];let nextParam;let total=null;const seen=new Set();let truncated=false;
 for(let page=0;page<7;page++){
  const request={serviceId,playlistId:parsed.id};if(nextParam)request.nextParam=nextParam;
  const result=await providerCall('/public/inspect/playlistItems',request,env,fetchImpl);
  if(result.status!=='success'||!result.data||!Array.isArray(result.data.results))throw Object.assign(new Error('This playlist is unavailable from the public provider. Try a playlist you own using an authorized account.'),{status:422,code:'PUBLIC_PLAYLIST_UNAVAILABLE'});
  total=Number.isInteger(result.data.totalItems)?result.data.totalItems:total;
  for(const item of result.data.results){
   const track=mapPublicTrack(item);if(track&&tracks.length<300)tracks.push(track);
  }
  nextParam=result.data.nextParam||null;
  if(!nextParam)break;
  if(seen.has(nextParam))throw Object.assign(new Error('Playlist provider returned a repeating pagination cursor.'),{status:502});
  seen.add(nextParam);
  if(tracks.length>=300||page===6){truncated=true;break;}
 }
 if(!tracks.length)throw Object.assign(new Error('This playlist has no available tracks to import.'),{status:422});
 return {title:name,image,description,source:parsed.service,sourceUrl,tracks,truncated:truncated||Boolean(nextParam)||total>300,provider:'musicapi'};
}
module.exports={getPublicPlaylist,providerCall,hasPublicProvider,mapPublicTrack};
