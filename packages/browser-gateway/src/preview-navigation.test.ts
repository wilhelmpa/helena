import { describe, expect, it, mock } from 'bun:test';
import { checkPreviewNavigation, navigationError } from './preview-navigation';
import type { ManagedPreview } from './helena-client';

const url = 'http://127.0.0.1:24032/app';
const preview = (status: ManagedPreview['status']): ManagedPreview => ({
  name: 'main',
  status,
  url,
  lines: ['ready log'],
});

describe('preview navigation', () => {
  it('does not probe a stopped server and includes its log tail', async () => {
    const probe = mock(async () => new Response());
    const result = await checkPreviewNavigation(url, async () => [preview('stopped')], probe);
    expect(result.state).toMatchObject({
      type: 'preview-unreachable',
      reason: 'stopped',
      logs: ['ready log'],
    });
    expect(probe).not.toHaveBeenCalled();
  });

  it('waits for a starting server to answer before navigating', async () => {
    let calls = 0;
    const probe = mock(async () => new Response(null, { status: 404 }));
    const result = await checkPreviewNavigation(
      url,
      async () => [preview(++calls === 1 ? 'starting' : 'running')],
      probe,
      1_000,
    );
    expect(result).toEqual({ managed: true, state: null });
    expect(calls).toBe(2);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('keeps a disappearing starting server from reaching Chromium', async () => {
    let calls = 0;
    const result = await checkPreviewNavigation(
      url,
      async () => (++calls === 1 ? [preview('starting')] : []),
      mock(async () => new Response()),
      1_000,
    );
    expect(result.state).toMatchObject({ type: 'preview-unreachable', reason: 'stopped' });
  });

  it('accepts a normal page and reports Chromium connection refusal', async () => {
    const probe = mock(async () => new Response(null, { status: 200 }));
    expect(await checkPreviewNavigation(url, async () => [preview('running')], probe)).toEqual({
      managed: true,
      state: null,
    });
    expect(navigationError(url, new Error('net::ERR_CONNECTION_REFUSED'))).toMatchObject({
      type: 'navigation-error',
      code: 'ERR_CONNECTION_REFUSED',
    });
  });
});
