import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  frameRetryDelay,
  loadedFrameProblem,
  probeFrameUrl,
  sameOrigin,
  statusResult,
} from './frameProbe';

const origin = 'https://ava.example';
const answer = (status: number, type: ResponseType = 'basic') =>
  (async () => ({ status, type }) as Response) as unknown as typeof fetch;

describe('frameProbe', () => {
  it('reads an answer of the address: fine, an error, or no access', () => {
    assert.deepEqual(statusResult(200), { ok: true });
    assert.deepEqual(statusResult(302), { ok: true });
    assert.deepEqual(statusResult(404), { ok: false, reason: 'status', status: 404 });
    assert.deepEqual(statusResult(502), { ok: false, reason: 'status', status: 502 });
    assert.deepEqual(statusResult(403), { ok: false, reason: 'forbidden', status: 403 });
  });

  it('probes an address of this origin and of another', async () => {
    assert.deepEqual(await probeFrameUrl('/code/', { origin, fetcher: answer(200) }), { ok: true });
    assert.deepEqual(await probeFrameUrl('/code/', { origin, fetcher: answer(502) }), {
      ok: false,
      reason: 'status',
      status: 502,
    });
    // Another origin answers opaquely: it answered, that is all that can be known.
    assert.deepEqual(
      await probeFrameUrl('https://plugin.example/', { origin, fetcher: answer(0, 'opaque') }),
      { ok: true },
    );
    // A sign-in redirect is the frame's to follow.
    assert.deepEqual(
      await probeFrameUrl('/terminal/', { origin, fetcher: answer(0, 'opaqueredirect') }),
      { ok: true },
    );
  });

  it('tells a dead service from one that does not answer in time', async () => {
    const refused = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    assert.deepEqual(await probeFrameUrl('/code/', { origin, fetcher: refused }), {
      ok: false,
      reason: 'unreachable',
    });
    const hanging = ((_: string, init: RequestInit) =>
      new Promise((_resolve, reject) =>
        init.signal!.addEventListener('abort', () => reject(new Error('aborted'))),
      )) as unknown as typeof fetch;
    assert.deepEqual(await probeFrameUrl('/code/', { origin, fetcher: hanging, timeoutMs: 10 }), {
      ok: false,
      reason: 'timeout',
    });
  });

  it('sees the browser’s own error page in a frame of this origin', () => {
    assert.deepEqual(loadedFrameProblem({ contentDocument: null }, true), {
      ok: false,
      reason: 'blocked',
    });
    const errorPage = { location: { href: 'chrome-error://chromewebdata/' } } as Document;
    assert.deepEqual(loadedFrameProblem({ contentDocument: errorPage }, true), {
      ok: false,
      reason: 'blocked',
    });
    const page = { location: { href: 'https://ava.example/code/' } } as Document;
    assert.deepEqual(loadedFrameProblem({ contentDocument: page }, true), { ok: true });
    const throwing = {
      get contentDocument(): Document | null {
        throw new Error('SecurityError');
      },
    };
    assert.deepEqual(loadedFrameProblem(throwing, true), { ok: false, reason: 'blocked' });
    // Another origin can never be read and counts as loaded.
    assert.deepEqual(loadedFrameProblem({ contentDocument: null }, false), { ok: true });
  });

  it('asks again soon, then less often', () => {
    assert.equal(frameRetryDelay(0), 3000);
    assert.ok(frameRetryDelay(2) > frameRetryDelay(1));
    assert.equal(frameRetryDelay(99), 30000);
    assert.equal(sameOrigin('/x', origin), true);
    assert.equal(sameOrigin('https://other.example/x', origin), false);
  });
});
