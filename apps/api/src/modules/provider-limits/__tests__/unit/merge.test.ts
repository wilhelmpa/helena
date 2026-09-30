import { describe, expect, it } from 'bun:test';
import type { ProviderLimitView } from '../../service';
import { mergeSameSubscriptions } from '../../merge';

const view = (over: Partial<ProviderLimitView>): ProviderLimitView =>
  ({
    id: 1,
    provider: 'anthropic',
    account: 'acct-1',
    source: 'claude-code',
    login: 'owner',
    plan: 'max',
    windows: [
      { id: 'session', kind: 'session', usedPercent: 94, resetsAt: '2026-09-24T14:29:59.878Z' },
      { id: 'weekly', kind: 'weekly', usedPercent: 25, resetsAt: '2026-09-27T13:59:59.878Z' },
    ],
    observedAt: '2026-09-24T13:44:31.000Z',
    agents: [],
    ...over,
  }) as unknown as ProviderLimitView;

describe('mergeSameSubscriptions', () => {
  it('merges the same provider account even when resets differ', () => {
    const newer = view({ id: 2, observedAt: '2026-09-24T14:00:00.000Z', windows: [] });
    expect(mergeSameSubscriptions([view({}), newer])).toHaveLength(1);
  });
  it('does not identify an account from a single matching session reset', () => {
    const local = view({ account: 'loc-other', windows: [view({}).windows[0]!] });
    expect(mergeSameSubscriptions([view({}), local])).toHaveLength(2);
  });
  it('shows the Hermes login and the owner login of one plan once', () => {
    const owner = view({ id: 2 });
    const hermes = view({
      id: 10,
      account: 'acct-1',
      source: 'hermes',
      login: 'hermes',
      plan: null,
      observedAt: '2026-09-24T13:44:55.000Z',
      agents: [{ id: 1, name: 'Home' }],
      windows: [
        { id: 'session', kind: 'session', usedPercent: 95, resetsAt: '2026-09-24T14:29:59.649Z' },
        { id: 'weekly', kind: 'weekly', usedPercent: 25, resetsAt: '2026-09-27T13:59:59.649Z' },
      ] as never,
    });
    const [one, ...rest] = mergeSameSubscriptions([hermes, owner]);
    expect(rest).toHaveLength(0);
    expect(one!.account).toBe('acct-1');
    expect(one!.plan).toBe('max');
    expect(one!.agents).toEqual([{ id: 1, name: 'Home' }]);
    expect(one!.windows[0]!.usedPercent).toBe(95);
  });

  it('keeps distinct accounts apart even when all reset times match', () => {
    expect(mergeSameSubscriptions([view({}), view({ account: 'loc-other' })])).toHaveLength(2);
  });

  it('keeps accounts apart whose windows end at other times, or that are both real', () => {
    const other = view({
      id: 3,
      account: 'loc-other',
      windows: [
        { id: 'session', kind: 'session', usedPercent: 10, resetsAt: '2026-09-24T18:00:00.000Z' },
      ] as never,
    });
    expect(mergeSameSubscriptions([view({}), other])).toHaveLength(2);
    expect(mergeSameSubscriptions([view({}), view({ id: 4, account: 'acct-2' })])).toHaveLength(2);
    expect(
      mergeSameSubscriptions([view({}), view({ id: 5, provider: 'openai', account: 'loc-x' })]),
    ).toHaveLength(2);
  });
});
