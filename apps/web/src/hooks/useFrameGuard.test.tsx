import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act, useEffect, useState } from 'react';
import { withDom, wait } from '../../test/dom';
import { useFrameGuard, type FrameGuardState } from './useFrameGuard';
import type { FrameProbeResult } from '@/utils/frameProbe';

// The frame guard of an embedded tool (Auftrag 116): no frame before the address answers,
// Ava's own view when it does not, a time limit while it loads, and a reconnect by itself.
function Harness({
  answers,
  onState,
  loadTimeoutMs = 60_000,
}: {
  answers: FrameProbeResult[];
  onState: (state: FrameGuardState, showFrame: boolean, session: number) => void;
  loadTimeoutMs?: number;
}) {
  // Stable, as the real probe is: a new function would ask again on every render.
  const [probe] = useState(() => async () => answers.shift() ?? ({ ok: true } as const));
  const [retryDelay] = useState(() => () => 20);
  const guard = useFrameGuard({ url: '/code/', active: true, probe, loadTimeoutMs, retryDelay });
  useEffect(() => onState(guard.state, guard.showFrame, guard.session));
  return guard.showFrame ? (
    <iframe title="code" data-session={guard.session} onLoad={() => undefined} />
  ) : null;
}

test('shows no frame while the tool is down and reconnects once it answers', async () => {
  await withDom('https://ava.example/', async () => {
    const { createRoot } = await import('react-dom/client');
    const root = createRoot(document.querySelector('#root')!);
    const seen: string[] = [];
    let last: { state: FrameGuardState; showFrame: boolean } | null = null;
    await act(async () => {
      root.render(
        <Harness
          answers={[
            { ok: false, reason: 'unreachable' },
            { ok: false, reason: 'status', status: 502 },
          ]}
          onState={(state, showFrame) => {
            last = { state, showFrame };
            seen.push(state.phase);
          }}
        />,
      );
    });
    await act(async () => wait(5));
    assert.equal(last!.state.phase, 'failed');
    assert.equal(last!.showFrame, false);
    assert.equal(document.querySelector('iframe'), null);
    // Two retries later the service answers: the frame loads by itself.
    // Each act() flushes the effects that schedule the next try.
    for (let i = 0; i < 6; i += 1) await act(async () => wait(30));
    assert.equal(last!.state.phase, 'loading');
    assert.ok(document.querySelector('iframe'));
    assert.ok(seen.includes('failed'));
    await act(async () => root.unmount());
  });
});

test('a frame that does not load in time shows the problem view', async () => {
  await withDom('https://ava.example/', async () => {
    const { createRoot } = await import('react-dom/client');
    const root = createRoot(document.querySelector('#root')!);
    let last: FrameGuardState | null = null;
    await act(async () => {
      root.render(
        <Harness
          answers={[{ ok: true }, { ok: false, reason: 'unreachable' }]}
          loadTimeoutMs={30}
          onState={(state) => {
            last = state;
          }}
        />,
      );
    });
    await act(async () => wait(5));
    await act(async () => wait(60));
    assert.equal(last!.phase, 'failed');
    assert.equal((last as unknown as { reason: string }).reason, 'timeout');
    await act(async () => root.unmount());
  });
});

test('asks again when the device is back online', async () => {
  await withDom('https://ava.example/', async () => {
    const { createRoot } = await import('react-dom/client');
    const root = createRoot(document.querySelector('#root')!);
    let sessions: number[] = [];
    let last: FrameGuardState | null = null;
    const answers: FrameProbeResult[] = [{ ok: true }];
    await act(async () => {
      root.render(
        <Harness
          answers={answers}
          onState={(state, _show, session) => {
            last = state;
            sessions.push(session);
          }}
        />,
      );
    });
    await act(async () => wait(5));
    assert.equal(last!.phase, 'loading');
    // The network changed and the service is gone: the frame gives way to the problem view.
    answers.push({ ok: false, reason: 'unreachable' });
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await wait(5);
    });
    assert.equal(last!.phase, 'failed');
    sessions = [];
    // It answers again: a fresh frame (a new session).
    for (let i = 0; i < 4; i += 1) await act(async () => wait(30));
    assert.equal(last!.phase, 'loading');
    assert.ok(sessions.some((session) => session >= 2));
    await act(async () => root.unmount());
  });
});
