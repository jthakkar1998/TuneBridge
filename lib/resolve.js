const DEMO = {
  title: 'Never Gonna Give You Up',
  artist: 'Rick Astley',
  source: 'demo',
  platforms: {
    spotify: 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
    apple_music: 'https://music.apple.com/us/song/1559885421'
  }
};

function recognize(urlText) {
  try {
    const url = new URL(urlText);
    if (url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    if (['open.spotify.com', 'spotify.link'].includes(host)) {
      if (host === 'open.spotify.com' && !/^\/(intl-[a-z]{2}\/)?track\/[a-zA-Z0-9]{22}\/?$/.test(url.pathname)) return null;
      return 'spotify';
    }
    if (['music.apple.com', 'geo.music.apple.com'].includes(host)) {
      if (!(/\/song\//.test(url.pathname) || (/\/album\//.test(url.pathname) && url.searchParams.has('i')))) return null;
      return 'apple_music';
    }
    return null;
  } catch (_) { return null; }
}

function demoMatch(urlText) {
  // A single verified illustrative example; require exact track identifiers.
  try {
    const url = new URL(urlText);
    if (recognize(urlText) === 'spotify') return /\/track\/4cOdK2wGLETKBW3PvgPWqT\/?$/.test(url.pathname);
    if (recognize(urlText) === 'apple_music') return /\/song\/1559885421\/?$/.test(url.pathname) || url.searchParams.get('i') === '1559885421';
    return false;
  } catch { return false; }
}

function normalizePayload(input, originalUrl) {
  const item = Array.isArray(input?.data) ? input.data.find(i => i?.type === 'track') || input.data[0] : input?.data;
  if (!item || !item.platforms) return null;
  const platformUrls = {};
  for (const key of ['spotify', 'apple_music']) {
    const candidate = item.platforms[key];
    if (typeof candidate === 'string' && recognize(candidate) === key) platformUrls[key] = candidate;
  }
  const inputPlatform = recognize(originalUrl);
  if (inputPlatform && !platformUrls[inputPlatform]) platformUrls[inputPlatform] = originalUrl;
  return {
    title: String(item.title || item.name || 'Shared track'),
    artist: String(item.artist || item.artists?.map(a => a.name || a).join(', ') || 'Unknown artist'),
    image: typeof (item.image_url || item.artwork_url) === 'string' ? (item.image_url || item.artwork_url) : null,
    platforms: platformUrls,
    source: 'live',
  };
}

async function resolveTrack(inputUrl, env = process.env, fetchImpl = fetch) {
  const sourcePlatform = recognize(inputUrl);
  if (!sourcePlatform) return { status: 400, body: { error: 'Paste a Spotify or Apple Music *song* URL (not a playlist or album).' } };
  const demo = demoMatch(inputUrl);
  const key = env.MUSICLINK_API_KEY;
  if (!key && demo) {
    return { status: 200, body: { ...DEMO, sourcePlatform, demo: true } };
  }
  if (!key) {
    return { status: 503, body: { error: 'Live song matching needs a MusicLink API key. The example song works without one.', code: 'NO_API_KEY' } };
  }
  try {
    const endpoint = new URL('https://api.musiclink.one/v2/resolve');
    endpoint.searchParams.set('q', inputUrl);
    const response = await fetchImpl(endpoint.toString(), {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      const code = response.status;
      return { status: code === 429 ? 429 : 502, body: { error: code === 429 ? 'Song matching is rate limited. Try again soon.' : `Song matching service returned ${code}.` } };
    }
    const payload = await response.json();
    const result = normalizePayload(payload, inputUrl);
    if (!result) return { status: 404, body: { error: 'No matching track found across streaming services.' } };
    return { status: 200, body: { ...result, sourcePlatform } };
  } catch (error) {
    return { status: 502, body: { error: 'Could not reach the song matching service.' } };
  }
}

module.exports = { resolveTrack, recognize, demoMatch };
