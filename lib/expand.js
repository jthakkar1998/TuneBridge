'use strict';
const {parseMusicUrl}=require('./music');
function bad(message,status=400){return Object.assign(new Error(message),{status});}
async function expandSpotifyShortUrl(text, fetchImpl=fetch){
 let url;
 try{url=new URL(text);}catch{throw bad('Enter a valid Spotify share URL.');}
 if(url.protocol!=='https:'||url.hostname!=='spotify.link')throw bad('Only Spotify short links from spotify.link are supported.');
 for(let i=0;i<5;i++){
  const response=await fetchImpl(url.toString(),{method:'GET',redirect:'manual',signal:AbortSignal.timeout(8000)});
  if(response.status<300||response.status>399)throw bad('Spotify did not provide a usable track or playlist redirect.',422);
  const location=response.headers.get('location');
  if(!location)throw bad('The Spotify share link did not contain a redirect.',422);
  const next=new URL(location,url);
  const songOrPlaylist=parseMusicUrl(next.href);
  if(songOrPlaylist&&songOrPlaylist.service==='spotify')return {url:songOrPlaylist.url,type:songOrPlaylist.type};
  if(next.protocol!=='https:'||next.hostname!=='spotify.link')throw bad('Spotify redirected to a non-track or non-playlist page.',422);
  url=next;
 }
 throw bad('Too many Spotify redirects.',422);
}
module.exports={expandSpotifyShortUrl};
