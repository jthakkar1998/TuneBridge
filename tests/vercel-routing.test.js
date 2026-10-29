'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { handler } = require('../server');
const vercel = require('../vercel.json');
const entrypoint = require('../api/index');

test('Vercel config uses exactly one API entrypoint and preserves the path in the rewrite', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const apiRoot = path.join(__dirname, '..', 'api');
  const files = fs.readdirSync(apiRoot, { withFileTypes:true }).filter(x=>x.isFile()&&x.name.endsWith('.js'));
  assert.deepEqual(files.map(x=>x.name), ['index.js']);
  assert.equal(vercel.rewrites.length, 1);
  assert.deepEqual(vercel.rewrites[0], {
    source: '/api/:path*', destination: '/api/index?route=:path*'
  });
  assert.equal(entrypoint, handler);
});

test('rewritten API requests reach the original endpoints and keep query/body data', async () => {
  const server = http.createServer(handler);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const status = await fetch(`${base}/api/index?route=status`);
    assert.equal(status.status, 200);
    assert.equal(typeof (await status.json()).songConfigured, 'boolean');
    const demo = await fetch(`${base}/api/index?route=demo`);
    assert.equal(demo.status, 200);
    assert.equal((await demo.json()).title, 'The after hours edit');
    const url = 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT';
    const resolve = await fetch(`${base}/api/index?route=resolve&url=${encodeURIComponent(url)}`);
    assert.equal(resolve.status, 200);
    assert.equal((await resolve.json()).platforms.apple_music, 'https://music.apple.com/us/song/1559885421');
    const apple = await fetch(`${base}/api/index?route=apple/playlist&url=invalid`);
    assert.equal(apple.status, 400); // Route exists; source URL fails validation.
    const create = await fetch(`${base}/api/index?route=spotify/create`, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({title:'New playlist', ids:[]})
    });
    assert.equal(create.status, 400); // Route exists; no tracks were submitted.
    const normal = await fetch(`${base}/api/status`);
    assert.equal(normal.status, 200); // Local server remains backward compatible.
  } finally {
    await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
  }
});
