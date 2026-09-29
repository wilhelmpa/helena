import { describe, expect, it } from 'bun:test';
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
    const result = await checkPreviewNavigation(url, async () => [preview('stopped')]);
    expect(result.state).toMatchObject({
      type: 'preview-unreachable',
      reason: 'stopped',
      logs: ['ready log'],
    });
    expect(result.state?.nextStep).toContain('preview_start');
  });

  it('waits for a starting server to answer before navigating', async () => {
    let calls = 0;
    const result = await checkPreviewNavigation(
      url,
      async () => [preview(++calls === 1 ? 'starting' : 'running')],
      1_000,
    );
    expect(result).toEqual({ managed: true, state: null });
    expect(calls).toBe(2);
  });

  it('keeps a disappearing starting server from reaching Chromium', async () => {
    let calls = 0;
    const result = await checkPreviewNavigation(
      url,
      async () => (++calls === 1 ? [preview('starting')] : []),
      1_000,
    );
    expect(result.state).toMatchObject({ type: 'preview-unreachable', reason: 'stopped' });
  });

  it('prefers a running preview over an old stopped entry on the same port', async () => {
    expect(
      await checkPreviewNavigation(url, async () => [
        preview('stopped'),
        { ...preview('running'), name: 'homepage-dev' },
      ]),
    ).toEqual({
      managed: true,
      state: null,
    });
  });

  it('reports Chromium connection refusal', () => {
    expect(navigationError(url, new Error('net::ERR_CONNECTION_REFUSED'))).toMatchObject({
      type: 'navigation-error',
      code: 'ERR_CONNECTION_REFUSED',
    });
  });
});
