const test=require('node:test');
const assert=require('node:assert/strict');
const {parseMusicUrl,cleanTrack,matchScore,example}=require('../lib/music');
const {getSpotifyPlaylist,createSpotifyPlaylist,matchSpotify}=require('../lib/spotify');
const {getApplePlaylist,createApplePlaylist,matchApple}=require('../lib/apple');
const {validateShare}=require('../lib/shares');
const {validateIds}=require('../server');
const spotifyPlaylist='https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M';
const applePlaylist='https://music.apple.com/us/playlist/chill-vibes/pl.01234567';
const spotifySong='https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT';
const appleSong='https://music.apple.com/us/album/hello/123456789?i=1559885421';
function response(data,status=200){return {ok:status>=200&&status<300,status,text:async()=>JSON.stringify(data)};}
const song={id:'4cOdK2wGLETKBW3PvgPWqT',type:'track',name:'A Great Song',artists:[{name:'The Artist'}],external_ids:{isrc:'USABC1234567'},duration_ms:200000,external_urls:{spotify:spotifySong},album:{images:[]}};
test('validates both service URL types and rejects lookalikes',()=>{
 assert.deepEqual(parseMusicUrl(spotifyPlaylist)?.type,'playlist');
 assert.deepEqual(parseMusicUrl(applePlaylist)?.type,'playlist');
 assert.deepEqual(parseMusicUrl(spotifySong)?.type,'song');
 assert.deepEqual(parseMusicUrl(appleSong)?.id,'1559885421');
 assert.equal(parseMusicUrl('https://open.spotify.com.evil.net/playlist/37i9dQZF1DXcBWIGoYBM5M'),null);
 assert.equal(parseMusicUrl('http://music.apple.com/us/playlist/abc/pl.0123'),null);
});
test('track normalization and recording similarity',()=>{
 const a=cleanTrack({name:' A Great Song ',artist:'The Artist',isrc:'usabc1234567',duration:200000});
 assert.equal(a.isrc,'USABC1234567');assert.ok(matchScore(a,{...a,name:'A Great Song (Remastered 2015)'})>.8);
 assert.equal(cleanTrack({name:'Missing Artist'}),null);
});
test('Spotify playlist read preserves order, skips local files',async()=>{
 const requests=[];const fetcher=async(url)=>{
  requests.push(new URL(url).pathname);
  if(new URL(url).pathname==='/v1/playlists/37i9dQZF1DXcBWIGoYBM5M')return response({name:'Test Mix',description:'Fun',external_urls:{spotify:spotifyPlaylist}});
  return response({total:3,items:[{item:song},{item:{...song,name:'Second Song'}},{is_local:true,item:{...song,name:'Local Song'}}]});
 };
 const result=await getSpotifyPlaylist('37i9dQZF1DXcBWIGoYBM5M','access-token',fetcher);
 assert.equal(result.title,'Test Mix');assert.deepEqual(result.tracks.map(t=>t.name),['A Great Song','Second Song']);assert.ok(requests.includes('/v1/playlists/37i9dQZF1DXcBWIGoYBM5M/items'));
});
test('Spotify create uses current /me/playlists and /items endpoints, preserves track order',async()=>{
 const calls=[];const fetcher=async(url,opts)=>{calls.push({path:new URL(url).pathname,body:JSON.parse(opts.body)});return response(calls.length===1?{id:'ABCDEF1234567890123456',external_urls:{spotify:spotifyPlaylist}}:{});};
 const result=await createSpotifyPlaylist('My Mix',['4cOdK2wGLETKBW3PvgPWqT','4uLU6hMCjMI75M1A2tKUQC'],'secret',fetcher);
 assert.equal(result.service,'spotify');assert.equal(calls[0].path,'/v1/me/playlists');assert.equal(calls[0].body.public,false);assert.equal(calls[1].path,'/v1/playlists/ABCDEF1234567890123456/items');assert.deepEqual(calls[1].body.uris,['spotify:track:4cOdK2wGLETKBW3PvgPWqT','spotify:track:4uLU6hMCjMI75M1A2tKUQC']);
});
test('Spotify track matching uses ISRC and returns confidence',async()=>{
 const fetcher=async()=>response({tracks:{items:[song]}});
 const result=await matchSpotify([{name:'A Great Song',artist:'The Artist',isrc:'USABC1234567',duration:200000}],'token',fetcher);
 assert.equal(result[0].status,'matched');assert.equal(result[0].id,song.id);
});
test('Apple catalog playlist read gets meta and ordered tracks',async()=>{
 const calls=[];const fetcher=async(url)=>{calls.push(new URL(url).pathname);return calls.length===1?response({data:[{attributes:{name:'Apple Set',description:{standard:'Night drive'}}}]}):response({data:[{id:'123456',attributes:{name:'A Great Song',artistName:'The Artist',isrc:'USABC1234567',durationInMillis:200000,url:appleSong}}]});};
 const data=await getApplePlaylist(parseMusicUrl(applePlaylist),'',{APPLE_DEVELOPER_TOKEN:'test-token'},fetcher);
 assert.equal(data.title,'Apple Set');assert.equal(data.tracks[0].name,'A Great Song');assert.equal(calls[1],'/v1/catalog/us/playlists/pl.01234567/tracks');
});
test('Apple matching prefers ISRC where available',async()=>{
 const fetcher=async()=>response({data:[{id:'1559885421',attributes:{name:'A Great Song',artistName:'The Artist',isrc:'USABC1234567',durationInMillis:200000}}]});
 const list=await matchApple([{name:'A Great Song',artist:'The Artist',isrc:'USABC1234567',duration:200000}],'us',{APPLE_DEVELOPER_TOKEN:'test-token'},fetcher);
 assert.equal(list[0].id,'1559885421');assert.equal(list[0].status,'matched');
});
test('Apple create requires user authorization and creates a library playlist',async()=>{
 const calls=[];const fetcher=async(url,opts)=>{calls.push({path:new URL(url).pathname,body:JSON.parse(opts.body),userToken:opts.headers['Music-User-Token']});return response({data:[{id:'p.1xyz'}]},201);};
 const result=await createApplePlaylist('Apple Mix',['1559885421'],'music-user-token',{APPLE_DEVELOPER_TOKEN:'developer-token'},fetcher);
 assert.equal(result.id,'p.1xyz');assert.equal(result.url,null);assert.equal(calls[0].path,'/v1/me/library/playlists');assert.equal(calls[0].userToken,'music-user-token');assert.equal(calls[0].body.relationships.tracks.data[0].type,'songs');
 await assert.rejects(createApplePlaylist('No auth',['1559885421'],'',{APPLE_DEVELOPER_TOKEN:'developer-token'},fetcher),/Authorize Apple Music/);
});
test('share and destination identifiers reject invalid data',()=>{
 const safe=validateShare({...example,sourceUrl:spotifyPlaylist});assert.equal(safe.tracks.length,8);
 assert.throws(()=>validateShare({title:'Bad',source:'spotify',tracks:[{name:'Title'}]}),/Every playlist/);
 assert.throws(()=>validateIds(['javascript:alert(1)'],'apple'),/Invalid song/);
 assert.deepEqual(validateIds(['1559885421'],'apple'),['1559885421']);
});
