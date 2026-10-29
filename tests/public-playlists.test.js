'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {getPublicPlaylist,mapPublicTrack,providerCall}=require('../lib/public-playlists');
const {supabaseHeaders}=require('../lib/shares');
const {createAppleToken}=require('../lib/music');
const SPOTIFY='https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M';
const APPLE='https://music.apple.com/us/playlist/summer/pl.u-Xyz123';
const track=n=>({name:n,artists:[{name:'An Artist'}],isrc:'USABC1234567',duration:180000,imageUrl:'https://example.com/cover.jpg',isAvailable:true});
const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
test('public playlist adapter paginates, retains order and maps ISRC, using only credentialed requests',async()=>{
 const calls=[];
 const fetcher=async(url,opts)=>{
  assert.equal(new URL(url).host,'api.musicapi.com');
  assert.equal(opts.headers.Authorization,'Token fake-client-id');
  calls.push({path:new URL(url).pathname,body:JSON.parse(opts.body)});
  if(url.includes('/inspect/url'))return response({status:'success',type:'playlist',data:{name:'Evening Mix',imageUrl:'https://example.com/image.jpg'}});
  if(calls.length===2)return response({status:'success',data:{results:[track('Track 1'),null],nextParam:'next-page',totalItems:3}});
  return response({status:'success',data:{results:[track('Track 2')],nextParam:null,totalItems:3}});
 };
 const result=await getPublicPlaylist(SPOTIFY,{MUSICAPI_CLIENT_ID:'fake-client-id'},fetcher);
 assert.equal(result.title,'Evening Mix');assert.equal(result.provider,'musicapi');assert.equal(result.truncated,false);
 assert.deepEqual(result.tracks.map(t=>t.name),['Track 1','Track 2']);
 assert.equal(result.tracks[0].isrc,'USABC1234567');
 assert.equal(calls[2].body.nextParam,'next-page');assert.equal(calls[2].body.serviceId,'spotify');
});
test('Apple public playlist IDs routed as appleMusic',async()=>{
 const calls=[];const f=async(url,opts)=>{calls.push(JSON.parse(opts.body));return url.endsWith('inspect/url')?response({status:'not_found'}):response({status:'success',data:{results:[track('One')],nextParam:null,totalItems:1}});};
 const d=await getPublicPlaylist(APPLE,{MUSICAPI_CLIENT_ID:'x',MUSICAPI_CLIENT_SECRET:'secret'},f);
 assert.equal(calls[1].serviceId,'appleMusic');assert.equal(d.tracks.length,1);
});
test('missing public provider fails safely, no unsupported claimed conversion',async()=>{
 await assert.rejects(getPublicPlaylist(SPOTIFY,{},async()=>{throw Error('must not fetch');}),e=>e.status===503&&e.code==='PUBLIC_PROVIDER_NOT_CONFIGURED');
 assert.equal(mapPublicTrack({...track('Unavailable'),isAvailable:false}),null);
});
test('provider billing failure surfaces precise configuration error',async()=>{
 await assert.rejects(providerCall('/public/inspect/playlistItems',{playlistId:'id'},{MUSICAPI_CLIENT_ID:'x'},async()=>response({},402)),e=>e.code==='PROVIDER_BILLING');
});
test('Supabase modern server secrets only sent in apikey, legacy keys still work',()=>{
 assert.deepEqual(supabaseHeaders({SUPABASE_SECRET_KEY:'sb_secret_abc'}),{apikey:'sb_secret_abc'});
 assert.deepEqual(supabaseHeaders({SUPABASE_SERVICE_ROLE_KEY:'jwt-role'}),{apikey:'jwt-role',Authorization:'Bearer jwt-role'});
});
test('Apple developer origin claim is correctly an array',()=>{
 const {generateKeyPairSync}=require('node:crypto');const privateKey=generateKeyPairSync('ec',{namedCurve:'P-256'}).privateKey.export({type:'pkcs8',format:'pem'});
 const token=createAppleToken({APPLE_TEAM_ID:'TEAM',APPLE_KEY_ID:'KEY',APPLE_PRIVATE_KEY:privateKey,APPLE_ORIGIN:'https://app.example.com'});
 const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());
 assert.deepEqual(claims.origin,['https://app.example.com']);
});
