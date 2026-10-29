'use strict';
const http=require('node:http');const fs=require('node:fs/promises');const path=require('node:path');
const {parseMusicUrl,createAppleToken,example}=require('./lib/music');
const {getSpotifyPlaylist,matchSpotify,createSpotifyPlaylist}=require('./lib/spotify');
const {getPublicPlaylist,hasPublicProvider}=require('./lib/public-playlists');
const {expandSpotifyShortUrl}=require('./lib/expand');
const {getApplePlaylist,matchApple,createApplePlaylist}=require('./lib/apple');
const {saveShare,getShare,verifyUser,hasSupabase}=require('./lib/shares');
const resolve=require('./lib/resolve');
const ROOT=__dirname;const staticFiles={'/':'index.html','/index.html':'index.html','/styles.css':'styles.css','/app.js':'app.js','/config.js':'config.js','/favicon.svg':'favicon.svg','/manifest.webmanifest':'manifest.webmanifest','/icon-180.png':'icon-180.png','/icon-192.png':'icon-192.png','/icon-512.png':'icon-512.png'};
function send(res,status,body){res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(body));}
async function body(req){const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>180000)throw Object.assign(new Error('Request exceeds size limit.'),{status:413});chunks.push(c);}try{return JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{throw Object.assign(new Error('Invalid JSON.'),{status:400});}}
function tokenHeader(req){return (req.headers.authorization||'').replace(/^Bearer\s+/i,'');}
function appToken(req){return String(req.headers['music-user-token']||'');}
function validateTracks(arr){if(!Array.isArray(arr)||arr.length<1||arr.length>50)throw Object.assign(new Error('Match up to 50 songs at a time.'),{status:400});return arr;}
function validateIds(arr,service){if(!Array.isArray(arr)||!arr.length||arr.length>300)throw Object.assign(new Error('Choose 1–300 matched songs.'),{status:400});const regex=service==='spotify'?/^[A-Za-z0-9]{22}$/:/^\d+$/;if(arr.some(id=>!regex.test(String(id))))throw Object.assign(new Error('Invalid song identifiers.'),{status:400});return arr;}
// Limit expensive matching and playlist writes on a per-process basis; use a gateway rate limit for public production.
const buckets=new Map();function throttle(req,key,max=14){const addr=String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'local').split(',')[0].slice(0,80);const now=Date.now(),id=addr+':'+key;let rec=buckets.get(id);if(!rec||now-rec.at>60000)rec={at:now,n:0};rec.n++;buckets.set(id,rec);if(rec.n>max)throw Object.assign(new Error('Too many requests. Please retry shortly.'),{status:429});if(buckets.size>10000)buckets.clear();}
async function handler(req,res){
 try{
  const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
  // Vercel rewrites /api/* to the sole /api/index function. The route
  // parameter retains the public API URL even if Vercel changes req.url.
  const rewrittenRoute=url.pathname==='/api/index'?url.searchParams.get('route'):null;
  const pathname=rewrittenRoute?'/api/'+rewrittenRoute.replace(/^\/+/, ''):url.pathname;
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  if(req.method==='GET'&&staticFiles[pathname]){
   const filename=staticFiles[pathname];const content=await fs.readFile(path.join(ROOT,filename));
   const mime=filename.endsWith('.html')?'text/html':filename.endsWith('.css')?'text/css':filename.endsWith('.js')?'application/javascript':filename.endsWith('.png')?'image/png':'image/svg+xml';
   res.setHeader('Content-Type',(filename.endsWith('.webmanifest')?'application/manifest+json':mime)+'; charset=utf-8');res.setHeader('Cache-Control','no-cache');return res.end(content);
  }
  if(pathname==='/api/expand'&&req.method==='GET'){throttle(req,'short-link',12);return send(res,200,await expandSpotifyShortUrl(url.searchParams.get('url')||''));}
  if(pathname==='/api/status'&&req.method==='GET')return send(res,200,{appleConfigured:!!createAppleToken(),songConfigured:!!process.env.MUSICLINK_API_KEY,storageConfigured:hasSupabase(process.env)||!process.env.VERCEL,spotifyClientRequired:true,publicPlaylistProviderConfigured:hasPublicProvider(), publicPlaylistProvider:'MusicAPI (optional)'});
  if(pathname==='/api/demo'&&req.method==='GET')return send(res,200,example);
  if(pathname==='/api/resolve'&&['GET','POST'].includes(req.method)){
   const data=req.method==='POST'?await body(req):{url:url.searchParams.get('url')};const result=await resolve.resolveTrack(data.url||'');return send(res,result.status,result.body);
  }
  if(pathname==='/api/public/playlist'&&req.method==='GET'){
   const input=url.searchParams.get('url')||'';
   if(input.length>1500)return send(res,400,{error:'URL too long.'});
   throttle(req,'public-playlist',7);
   return send(res,200,await getPublicPlaylist(input));
  }
  if(pathname==='/api/apple/token'&&req.method==='GET'){
   const t=createAppleToken();if(!t)return send(res,503,{error:'Apple Music developer credentials are not configured.'});return send(res,200,{token:t});
  }
  if(pathname==='/api/apple/playlist'&&req.method==='GET'){
   const parsed=parseMusicUrl(url.searchParams.get('url'));if(!parsed||parsed.service!=='apple_music'||parsed.type!=='playlist')return send(res,400,{error:'Enter a valid Apple Music playlist link.'});
   throttle(req,'apple-read',20);return send(res,200,await getApplePlaylist(parsed,appToken(req)));
  }
  if(pathname==='/api/spotify/playlist'&&req.method==='GET'){
   const parsed=parseMusicUrl(url.searchParams.get('url'));if(!parsed||parsed.service!=='spotify'||parsed.type!=='playlist')return send(res,400,{error:'Enter a valid Spotify playlist link.'});
   throttle(req,'spotify-read',20);return send(res,200,await getSpotifyPlaylist(parsed.id,tokenHeader(req)));
  }
  if(pathname==='/api/apple/match'&&req.method==='POST'){
   throttle(req,'apple-match',20);const input=await body(req);return send(res,200,{matches:await matchApple(validateTracks(input.tracks),input.storefront)});
  }
  if(pathname==='/api/spotify/match'&&req.method==='POST'){
   throttle(req,'spotify-match',20);const input=await body(req);return send(res,200,{matches:await matchSpotify(validateTracks(input.tracks),tokenHeader(req))});
  }
  if(pathname==='/api/apple/create'&&req.method==='POST'){
   throttle(req,'apple-create',5);const input=await body(req);if(typeof input.title!=='string'||!input.title.trim())return send(res,400,{error:'Playlist name required.'});
   return send(res,201,await createApplePlaylist(input.title,validateIds(input.ids,'apple'),appToken(req)));
  }
  if(pathname==='/api/spotify/create'&&req.method==='POST'){
   throttle(req,'spotify-create',5);const input=await body(req);if(typeof input.title!=='string'||!input.title.trim())return send(res,400,{error:'Playlist name required.'});
   return send(res,201,await createSpotifyPlaylist(input.title,validateIds(input.ids,'spotify'),tokenHeader(req)));
  }
  if(pathname==='/api/shares'&&req.method==='POST'){
   throttle(req,'share',8);if(!(await verifyUser(req.headers.authorization,process.env)))return send(res,401,{error:'Sign into TuneBridge to publish a playlist link.'});
   return send(res,201,await saveShare(await body(req)));
  }
  if(pathname==='/api/shares'&&req.method==='GET'){
   const share=await getShare(url.searchParams.get('id'));return share?send(res,200,share):send(res,404,{error:'This shared playlist could not be found.'});
  }
  return send(res,404,{error:'Not found'});
 }catch(e){const status=e.status>=400&&e.status<=599?e.status:500;if(status>=500)console.error('[TuneBridge]',e.message);return send(res,status,{error:status===500?'Unexpected server error. Check the server logs.':e.message,code:e.code||undefined});}
}
if(require.main===module){const port=Number(process.env.PORT)||3000;http.createServer(handler).listen(port,'0.0.0.0',()=>console.log(`TuneBridge: http://localhost:${port}`));}
module.exports={handler,validateIds};
