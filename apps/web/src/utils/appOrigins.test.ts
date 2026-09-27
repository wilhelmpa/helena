import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { parseOrigins, rebaseUrl, requestOrigin } from './appOrigins';
import { serverRuntimeEnv } from './runtimeEnv';

const PUBLIC = 'https://helena.example.com';
const HOME = 'https://helena-home.example.com';
const origins = [PUBLIC, HOME];

describe('the instance origins', () => {
  it('reads APP_URL as origins, the primary first, without paths or duplicates', () => {
    assert.deepEqual(parseOrigins(` ${PUBLIC}/ , ${HOME}/x ,${PUBLIC}, not a url, ftp://x.test`), [
      PUBLIC,
      HOME,
    ]);
    assert.deepEqual(parseOrigins(undefined), []);
  });

  it('knows the origin a request came in on only when it is one of them', () => {
    const headers = (host: string, proto?: string) =>
      new Headers({ host, ...(proto ? { 'x-forwarded-proto': proto } : {}) });
    assert.equal(requestOrigin(headers('helena-home.example.com', 'https'), origins), HOME);
    assert.equal(requestOrigin(headers('helena.example.com', 'https'), origins), PUBLIC);
    // Plain http of the same name is another origin.
    assert.equal(requestOrigin(headers('helena-home.example.com', 'http'), origins), null);
    assert.equal(requestOrigin(headers('evil.example.com', 'https'), origins), null);
    assert.equal(requestOrigin(headers('helena-home.example.com'), origins, 'https:'), HOME);
    assert.equal(requestOrigin(new Headers(), origins), null);
    // nginx's $host drops the port: the one origin with that scheme and name.
    const dev = ['http://localhost:25602', 'http://127.0.0.1:25602'];
    assert.equal(requestOrigin(headers('127.0.0.1', 'http'), dev), 'http://127.0.0.1:25602');
    assert.equal(requestOrigin(headers('127.0.0.1:9999', 'http'), dev), null);
    assert.equal(requestOrigin(headers('127.0.0.1', 'https'), dev), null);
  });

  it('moves an address on one origin to another and leaves the rest alone', () => {
    assert.equal(rebaseUrl(`${PUBLIC}/backend`, origins, HOME), `${HOME}/backend`);
    assert.equal(
      rebaseUrl(`${PUBLIC}/code/?folder=%2Fsrv#x`, origins, HOME),
      `${HOME}/code/?folder=%2Fsrv#x`,
    );
    assert.equal(rebaseUrl(PUBLIC, origins, HOME), HOME);
    assert.equal(
      rebaseUrl('https://other.example.com/x', origins, HOME),
      'https://other.example.com/x',
    );
    assert.equal(rebaseUrl('/relative', origins, HOME), '/relative');
    assert.equal(rebaseUrl(`${PUBLIC}/x`, origins, null), `${PUBLIC}/x`);
  });
});

describe('the runtime env on two origins', () => {
  const names = [
    'APP_URL',
    'API_URL',
    'TERMINAL_URL',
    'CODE_URL',
    'BROWSER_URL',
    'SSO_LOGOUT_URL',
    'HELENA_HOME_URL',
    'PASSKEY_RP_ID',
    'HELENA_NOTES_URLS',
  ] as const;
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    process.env.APP_URL = `${PUBLIC},${HOME}`;
    process.env.API_URL = `${PUBLIC}/backend`;
    process.env.TERMINAL_URL = `${PUBLIC}/terminal`;
    process.env.CODE_URL = `${PUBLIC}/code/`;
    process.env.BROWSER_URL = 'https://browser.elsewhere.test/view';
    process.env.SSO_LOGOUT_URL = `${PUBLIC}/cdn-cgi/access/logout`;
    process.env.HELENA_HOME_URL = HOME;
    process.env.PASSKEY_RP_ID = 'helena.example.com';
  });
  afterEach(() => {
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });

  it('hands out the api and the tools on the origin the page was opened on', () => {
    const env = serverRuntimeEnv(HOME);
    assert.equal(env.apiUrl, `${HOME}/backend`);
    assert.equal(env.workspace.terminalUrl, `${HOME}/terminal`);
    assert.equal(env.workspace.codeUrl, `${HOME}/code/`);
    // Another site, and the edge provider's sign-out, stay where they are.
    assert.equal(env.workspace.browserUrl, 'https://browser.elsewhere.test/view');
    assert.equal(env.logoutUrl, `${PUBLIC}/cdn-cgi/access/logout`);
    assert.deepEqual(env.appOrigins, [PUBLIC, HOME]);
    assert.equal(env.homeUrl, HOME);
    assert.equal(env.passkeyRpId, 'helena.example.com');
  });

  it('keeps the configured addresses on the primary origin or without a request', () => {
    assert.equal(serverRuntimeEnv(PUBLIC).apiUrl, `${PUBLIC}/backend`);
    assert.equal(serverRuntimeEnv().apiUrl, `${PUBLIC}/backend`);
    // An origin that is not the instance's moves nothing.
    assert.equal(serverRuntimeEnv('https://evil.example.com').apiUrl, `${PUBLIC}/backend`);
  });

  it('ignores legacy Notes mappings on every Helena origin', () => {
    process.env.HELENA_NOTES_URLS = JSON.stringify({
      [HOME]: `${HOME}:8446/`,
      [PUBLIC]: 'https://notes.example.com',
    });
    assert.equal(serverRuntimeEnv(HOME).workspace.notesUrl, '');
    assert.equal(serverRuntimeEnv(PUBLIC).workspace.notesUrl, '');
    // Without a request: the primary origin's.
    assert.equal(serverRuntimeEnv().workspace.notesUrl, '');
    // An origin that has none, a stranger, a path under Helena's own origin, a script URL.
    process.env.HELENA_NOTES_URLS = JSON.stringify({ [PUBLIC]: `${PUBLIC}/notes` });
    assert.equal(serverRuntimeEnv(PUBLIC).workspace.notesUrl, '');
    assert.equal(serverRuntimeEnv(HOME).workspace.notesUrl, '');
    process.env.HELENA_NOTES_URLS = JSON.stringify({ [HOME]: 'javascript:alert(1)' });
    assert.equal(serverRuntimeEnv(HOME).workspace.notesUrl, '');
    process.env.HELENA_NOTES_URLS = 'not json';
    assert.equal(serverRuntimeEnv(HOME).workspace.notesUrl, '');
  });

  it('names no home origin that is not one of the instance origins', () => {
    process.env.HELENA_HOME_URL = 'https://stray.example.com';
    assert.equal(serverRuntimeEnv(HOME).homeUrl, '');
  });
});
