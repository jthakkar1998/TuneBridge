const test=require('node:test');
const assert=require('node:assert/strict');
const {expandSpotifyShortUrl}=require('../lib/expand');
test('expands official Spotify shortened playlist and song URLs safely',async()=>{
 const fetcher=async()=>({status:302,headers:new Map([['location','https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=example']])});
 assert.deepEqual(await expandSpotifyShortUrl('https://spotify.link/aBcD',fetcher),{url:'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',type:'playlist'});
});
test('rejects arbitrary redirects and untrusted domains',async()=>{
 await assert.rejects(expandSpotifyShortUrl('https://spotify.link.evil.test/a',async()=>({})),/Only Spotify/);
 await assert.rejects(expandSpotifyShortUrl('https://spotify.link/a',async()=>({status:302,headers:new Map([['location','https://example.com/evil']])})),/non-track/);
});
