import { describe, expect, it } from 'bun:test';
import type { HelperStatus } from './helper';
import { aptFreshness, readUpdateInventory } from './inventory';

const cached = {
  apt: { listsUpdatedAt: '2026-09-26T20:09:53Z', refreshedAt: '2026-09-26T21:49:30Z' },
};
const answer = (action: string, fields: Partial<HelperStatus>): HelperStatus => ({
  id: 'fixture',
  action,
  state: 'done',
  ...fields,
});

describe('APT inventory freshness', () => {
  it('refreshes through the helper and distinguishes list mtime from successful refresh', async () => {
    const actions: string[] = [];
    const result = await readUpdateInventory(async (action) => {
      actions.push(action);
      return answer(action, { ok: true, result: cached });
    }, true);
    expect(actions).toEqual(['apt-refresh']);
    expect(aptFreshness(result)).toMatchObject({
      listsUpdatedAt: '2026-09-26T20:09:53.000Z',
      refreshedAt: '2026-09-26T21:49:30.000Z',
      refreshError: null,
    });
  });
  it('keeps cached inventory but marks refresh failure without mutating the cache', async () => {
    const actions: string[] = [];
    const result = await readUpdateInventory(async (action) => {
      actions.push(action);
      return action === 'apt-refresh'
        ? answer(action, { ok: false, error: 'index fetch failed' })
        : answer(action, { ok: true, result: cached });
    }, true);
    expect(actions).toEqual(['apt-refresh', 'inventory']);
    expect(aptFreshness(result)?.refreshError).toBe('index fetch failed');
    expect(aptFreshness(cached)?.refreshError).toBeNull();
  });
  it('does not treat old helper success or an exception as proof of fresh lists', async () => {
    for (const fail of [false, true]) {
      const result = await readUpdateInventory(async (action) => {
        if (action === 'apt-refresh' && fail) throw new Error('timeout');
        return answer(action, {
          ok: true,
          result: { apt: { listsUpdatedAt: cached.apt.listsUpdatedAt } },
        });
      }, true);
      expect(aptFreshness(result)?.refreshError).toBeTruthy();
      expect(aptFreshness(result)?.refreshedAt).toBeNull();
    }
  });
  it('does not refresh APT for a check scoped to a different source', async () => {
    const actions: string[] = [];
    await readUpdateInventory(async (action) => {
      actions.push(action);
      return answer(action, { ok: true, result: cached });
    }, false);
    expect(actions).toEqual(['inventory']);
  });
  it('rejects an unavailable fallback and ignores invalid timestamps', async () => {
    await expect(
      readUpdateInventory(async (action) => answer(action, { ok: false, error: 'missing' }), false),
    ).rejects.toThrow('missing');
    expect(aptFreshness({ apt: { refreshedAt: 'not a date' } })?.refreshedAt).toBeNull();
  });
});
