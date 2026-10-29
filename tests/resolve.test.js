const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveTrack, recognize } = require('../lib/resolve');
const SPOTIFY = 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT';
const APPLE = 'https://music.apple.com/us/song/1559885421';

test('recognizes both direct service links and rejects non-music links', () => {
  assert.equal(recognize(SPOTIFY), 'spotify');
  assert.equal(recognize(APPLE), 'apple_music');
  assert.equal(recognize('https://music.apple.com/us/album/abc/123?i=456'), 'apple_music');
  assert.equal(recognize('https://open.spotify.com/playlist/123'), null);
  assert.equal(recognize('http://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT'), null);
  assert.equal(recognize('https://open.spotify.com.evil.com/track/4cOdK2wGLETKBW3PvgPWqT'), null);
});

test('demo maps Spotify to Apple Music, and Apple Music to Spotify without a key', async () => {
  const fromSpotify = await resolveTrack(SPOTIFY, {});
  const fromApple = await resolveTrack(APPLE, {});
  assert.equal(fromSpotify.status, 200);
  assert.equal(fromApple.status, 200);
  assert.equal(fromSpotify.body.platforms.apple_music, APPLE);
  assert.equal(fromApple.body.platforms.spotify, SPOTIFY);
  assert.equal(fromSpotify.body.demo, true);
});

test('normal real link requires key rather than hallucinating a match', async () => {
  const res = await resolveTrack('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC', {});
  assert.equal(res.status, 503);
  assert.equal(res.body.code, 'NO_API_KEY');
});

test('both platform links parsed from live MusicLink API v2 payload', async () => {
  const response = await resolveTrack('https://music.apple.com/us/song/1632632842', { MUSICLINK_API_KEY: 'test' }, async (url, options) => {
    assert.ok(url.startsWith('https://api.musiclink.one/v2/resolve?'));
    assert.equal(options.headers.Authorization, 'Bearer test');
    return { ok: true, json: async () => ({ success: true, data: [{ type: 'track', title: 'Never Gonna Give You Up', artist: 'Rick Astley', platforms: { spotify: SPOTIFY, apple_music: APPLE } }] }) };
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.platforms.spotify, SPOTIFY);
  assert.equal(response.body.platforms.apple_music, APPLE);
  assert.equal(response.body.source, 'live');
});

test('unavailable target omitted instead of falsely linked', async () => {
  const response = await resolveTrack(SPOTIFY, { MUSICLINK_API_KEY: 'test' }, async () => ({ ok:true, json: async () => ({ data:[{ type:'track', title:'A', artist:'B', platforms: { spotify: SPOTIFY, apple_music:'https://evil.test/track/abc' } }] }) }));
  assert.equal(response.status, 200);
  assert.equal(response.body.platforms.apple_music, undefined);
});
