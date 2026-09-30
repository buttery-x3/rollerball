import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createStaticServer } from './app.mjs';

test('serves compiled assets and refuses source files, traversal and missing assets', async (t) => {
  const fixture = await mkdtemp(path.join(tmpdir(), 'app-http-'));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  const root = path.join(fixture, 'build');
  await mkdir(path.join(root, '_app/immutable'), { recursive: true });
  await writeFile(path.join(root, 'index.html'), '<h1>App</h1>');
  await writeFile(path.join(root, '_app/immutable/app.js'), 'export const ready = true;');
  await writeFile(path.join(fixture, 'secret.txt'), 'private');
  const server = await createStaticServer(root);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  const home = await fetch(base);
  assert.equal(home.status, 200);
  assert.equal(await home.text(), '<h1>App</h1>');
  assert.equal(home.headers.get('cache-control'), 'no-cache');
  const head = await fetch(base, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  const asset = await fetch(base + '/_app/immutable/app.js');
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('content-type'), /javascript/);
  assert.match(asset.headers.get('cache-control'), /immutable/);
  assert.equal((await fetch(base + '/_app/immutable/missing.js')).status, 404);
  assert.equal((await fetch(base + '/package.json')).status, 404);
  assert.equal((await fetch(base + '/.git/config')).status, 403);
  assert.equal((await fetch(base + '/%2e%2e%2fsecret.txt')).status, 403);
  assert.equal((await fetch(base + '/%E0%A4%A')).status, 400);
  assert.equal((await fetch(base, { method: 'POST' })).status, 405);
  if (process.platform !== 'win32') {
    await symlink(path.join(fixture, 'secret.txt'), path.join(root, 'leak.txt'));
    assert.equal((await fetch(base + '/leak.txt')).status, 403);
  }
});
