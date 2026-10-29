'use strict';
const crypto = require('node:crypto');

function parseMusicUrl(text) {
  try {
    const u = new URL(text);
    if (u.protocol !== 'https:') return null;
    const host = u.hostname.toLowerCase();
    if (host === 'open.spotify.com') {
      const m = u.pathname.match(/^\/(?:intl-[a-z]{2}\/)?(track|playlist)\/([A-Za-z0-9]{22})\/?$/);
      return m ? {service:'spotify',type:m[1]==='track'?'song':'playlist',id:m[2],url:u.origin+u.pathname} : null;
    }
    if (host === 'music.apple.com' || host === 'geo.music.apple.com') {
      const parts = u.pathname.split('/').filter(Boolean);
      const country = /^[a-z]{2}$/i.test(parts[0]||'') ? parts[0].toLowerCase() : 'us';
      const ix = parts.indexOf('playlist');
      if (ix>=0 && parts[ix+2] && /^[A-Za-z0-9._-]+$/.test(parts[ix+2])) return {service:'apple_music',type:'playlist',id:parts[ix+2],storefront:country,url:u.origin+u.pathname};
      const songId = u.searchParams.get('i') || (parts.includes('song') ? parts.at(-1) : null);
      if (songId && /^\d+$/.test(songId)) return {service:'apple_music',type:'song',id:songId,storefront:country,url:u.toString()};
    }
  } catch (_) {}
  return null;
}
function cleanTrack(t) {
  if (!t || typeof t !== 'object') return null;
  const name=String(t.name||'').slice(0,180).trim(), artist=String(t.artist||'').slice(0,180).trim();
  if (!name||!artist) return null;
  const isrc = /^[a-zA-Z0-9]{12}$/.test(t.isrc||'') ? t.isrc.toUpperCase() : null;
  const duration = Number.isFinite(+t.duration) && +t.duration>0 && +t.duration<36000000 ? Math.round(+t.duration) : null;
  const url = typeof t.url==='string' && /^https:\/\//i.test(t.url) && t.url.length<650 ? t.url : null;
  const artwork = typeof t.artwork==='string' && /^https:\/\//i.test(t.artwork) && t.artwork.length<650 ? t.artwork : null;
  return {name,artist,isrc,duration,url,artwork};
}
function normalize(s) { return String(s||'').toLowerCase().normalize('NFKD').replace(/\p{Diacritic}/gu,'').replace(/\([^)]*(?:remaster|feat|live|version)[^)]*\)/gi,'').replace(/[^a-z0-9]+/g,' ').trim(); }
function matchScore(source,candidate) {
  if (!candidate) return 0;
  const a=normalize(source.name), b=normalize(candidate.name), sa=normalize(source.artist), sb=normalize(candidate.artist);
  const name = a===b?0.55:(a.includes(b)||b.includes(a)?0.35:0);
  const artist = sa===sb?0.3:(sa.includes(sb)||sb.includes(sa)?0.19:0);
  const isrc = source.isrc && candidate.isrc && source.isrc.toUpperCase()===candidate.isrc.toUpperCase()?0.95:0;
  const duration = source.duration && candidate.duration ? (Math.abs(source.duration-candidate.duration)<5000?0.12:Math.abs(source.duration-candidate.duration)<12000?0.05:-0.15) : 0;
  return Math.min(1,Math.max(0,Math.max(isrc,name+artist+duration)));
}
function createAppleToken(env=process.env, now=Math.floor(Date.now()/1000)) {
  if (env.APPLE_DEVELOPER_TOKEN) return env.APPLE_DEVELOPER_TOKEN;
  if (!env.APPLE_TEAM_ID || !env.APPLE_KEY_ID || !env.APPLE_PRIVATE_KEY) return null;
  const header=Buffer.from(JSON.stringify({alg:'ES256',kid:env.APPLE_KEY_ID,typ:'JWT'})).toString('base64url');
  const payload={iss:env.APPLE_TEAM_ID,iat:now,exp:now+3600};
  if(env.APPLE_ORIGIN) payload.origin=[env.APPLE_ORIGIN];
  const body=Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sign=crypto.sign('sha256',Buffer.from(`${header}.${body}`),{key:env.APPLE_PRIVATE_KEY.replace(/\\n/g,'\n'),dsaEncoding:'ieee-p1363'}).toString('base64url');
  return `${header}.${body}.${sign}`;
}
const example={
 title:'The after hours edit',description:'A little of everything for the ride home.',source:'spotify',demo:true,
 tracks:[
  ['Midnight City','M83'],['Electric Feel','MGMT'],['Pink + White','Frank Ocean'],['Dreams','Fleetwood Mac'],
  ['Redbone','Childish Gambino'],['Sunflower','Post Malone, Swae Lee'],['Nightcall','Kavinsky'],['Borderline','Tame Impala']
 ].map(([name,artist])=>({name,artist,isrc:null,duration:null,url:null,artwork:null}))
};
module.exports={parseMusicUrl,cleanTrack,normalize,matchScore,createAppleToken,example};
