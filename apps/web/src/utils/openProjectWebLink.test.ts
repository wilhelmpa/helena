import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { openProjectWebLink, WebLinkOpenError } from './openProjectWebLink';
import { BrowserControlError } from './browserControl';

let dom: JSDOM;
let original: PropertyDescriptor | undefined;
let requests: { url: string; init?: RequestInit }[];
let originalFetch: typeof fetch;
beforeEach(() => {
  original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  dom = new JSDOM('', { url: 'https://helena.test/project/VOL' });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: dom.window });
  window.__ITSAPLAN_ENV__ = {
    apiUrl: 'https://helena.test/api',
    privacyUrl: '',
    termsUrl: '',
    workspace: {
      homeChatProjectKey: '',
      terminalUrl: '',
      codeUrl: '',
      projectWorkspacePaths: {},
      homeWorkspacePath: '',
      browserUrl: 'https://helena.test/browser/projects/home/vnc.html',
      inboxUrl: '',
      connectionsUrl: '',
    },
  };
  requests = [];
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), init });
    return Response.json({ ok: true });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (original) Object.defineProperty(globalThis, 'window', original);
  else Reflect.deleteProperty(globalThis, 'window');
  dom.window.close();
});

test('a web link uses the actual source browser endpoint, never the current VOL project', async () => {
  const result = await openProjectWebLink('https://example.test/docs', 'OTHER');
  assert.equal(result.source, 'OTHER');
  assert.deepEqual(requests, [
    {
      url: 'https://helena.test/browser/projects/other/api/new',
      init: {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.test/docs' }),
      },
    },
  ]);
  await openProjectWebLink('http://127.0.0.1:24032/', null);
  assert.equal(requests[1]!.url, 'https://helena.test/browser/projects/home/api/new');
  assert.equal(JSON.parse(requests[1]!.init!.body as string).url, 'http://127.0.0.1:24032/');
});

test('missing or malformed source scope fails before any browser request', async () => {
  for (const scope of [undefined, '', '../OTHER', 'bad key']) {
    await assert.rejects(
      openProjectWebLink('https://example.test', scope),
      (error: unknown) => error instanceof WebLinkOpenError && error.reason === 'linkScopeMissing',
    );
  }
  assert.equal(requests.length, 0);
});

test('unsafe and internal app URLs cannot be sent as external browsing tasks', async () => {
  for (const url of [
    'javascript:alert(1)',
    'https://u:p@example.test',
    'https://helena.test/docs',
  ]) {
    await assert.rejects(openProjectWebLink(url, 'VOL'), WebLinkOpenError);
  }
  assert.equal(requests.length, 0);
});

test('a rejected browser request propagates and never retries into another project or window', async () => {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), init });
    return Response.json({ error: 'Access denied' }, { status: 403 });
  }) as typeof fetch;
  await assert.rejects(openProjectWebLink('https://example.test', 'OTHER'), BrowserControlError);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.url, 'https://helena.test/browser/projects/other/api/new');
});

test('generic browser configuration requires a matching provisioned source; a foreign resource cannot redirect it', async () => {
  window.__ITSAPLAN_ENV__!.workspace.browserUrl = 'https://helena.test/browser';
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), init });
    return Response.json({
      status: 'succeeded',
      result: {
        resources: [
          {
            kind: 'browser',
            id: 'project-browser:vol',
            url: 'https://helena.test/browser/projects/vol/vnc.html',
          },
        ],
      },
    });
  }) as typeof fetch;
  await assert.rejects(
    openProjectWebLink('https://example.test', 'OTHER'),
    (error: unknown) =>
      error instanceof WebLinkOpenError && error.reason === 'linkBrowserUnavailable',
  );
  assert.equal(requests.length, 1);
  assert.match(requests[0]!.url, /\/projects\/OTHER\/provisioning$/);
});

test('known alternate app origins remain app navigation, never a browser task', async () => {
  window.__ITSAPLAN_ENV__!.appOrigins = ['https://helena.test', 'https://helena.home'];
  await assert.rejects(
    openProjectWebLink('https://helena.home/project/OTHER', 'VOL'),
    WebLinkOpenError,
  );
  assert.equal(requests.length, 0);
});
