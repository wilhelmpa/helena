import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { judge, parseArgs } from './web-smoke.mjs';

const base = 'https://helena.example';
const clean = { path: '/', finalUrl: `${base}/`, base, exceptions: [], failedScripts: [], bodyText: 'Home', signedIn: true };

describe('web smoke', () => {
  it('reads its options', () => {
    const options = parseArgs(['--base', `${base}/x`, '--resolve', '127.0.0.1', '/login', '/chat']);
    assert.equal(options.base, base);
    assert.equal(options.resolve, '127.0.0.1');
    assert.deepEqual(options.paths, ['/login', '/chat']);
    assert.throws(() => parseArgs(['/']), /--base/);
    assert.throws(() => parseArgs(['--base', base, '--nope']), /unknown option/);
  });
  it('passes a page that rendered cleanly', () => {
    assert.deepEqual(judge(clean), []);
  });
  it('fails on an exception, a missing script, the error page, a stray sign-in or another origin', () => {
    assert.equal(judge({ ...clean, exceptions: ['TypeError: x is not a function'] }).length, 1);
    assert.equal(judge({ ...clean, failedScripts: [`${base}/_next/static/chunks/a.js (404)`] }).length, 1);
    assert.equal(judge({ ...clean, bodyText: 'Application error: a client-side exception has occurred' }).length, 1);
    assert.equal(judge({ ...clean, finalUrl: `${base}/login?callbackURL=%2F` }).length, 1);
    assert.equal(judge({ ...clean, finalUrl: 'https://login.example/' }).length, 1);
  });
  it('accepts the sign-in page when not signed in, and the sign-in page itself', () => {
    assert.deepEqual(judge({ ...clean, signedIn: false, finalUrl: `${base}/login` }), []);
    assert.deepEqual(judge({ ...clean, path: '/login', finalUrl: `${base}/login` }), []);
  });
});

const chromium = '/usr/bin/chromium';
const script = fileURLToPath(new URL('./web-smoke.mjs', import.meta.url));

// The real thing against a stand-in site: one clean page, one that throws, one whose script
// is missing.
describe('web smoke in Chromium', { skip: !existsSync(chromium) && 'no Chromium here' }, () => {
  async function site() {
    const server = createServer((request, response) => {
      response.setHeader('content-type', 'text/html');
      if (request.url === '/throws') response.end('<body>x<script>throw new Error("boom")</script>');
      else if (request.url === '/missing') response.end('<body>x<script src="/_next/static/gone.js"></script>');
      else if (request.url === '/_next/static/gone.js') {
        response.statusCode = 404;
        response.end('');
      } else response.end('<body>fine</body>');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return { server, base: `http://127.0.0.1:${server.address().port}` };
  }
  function smoke(base, ...paths) {
    return new Promise((resolve) => {
      execFile(process.execPath, [script, '--base', base, '--chromium', chromium, ...paths], { timeout: 90_000 },
        (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr }));
    });
  }
  it('passes a clean page and fails an exception and a missing script', async () => {
    const { server, base } = await site();
    try {
      const clean = await smoke(base, '/');
      assert.equal(clean.code, 0, clean.stderr);
      const thrown = await smoke(base, '/throws');
      assert.equal(thrown.code, 1);
      assert.match(thrown.stderr, /uncaught exception: .*boom/);
      const missing = await smoke(base, '/missing');
      assert.equal(missing.code, 1);
      assert.match(missing.stderr, /script did not load: .*gone\.js/);
    } finally {
      server.close();
    }
  });
});
