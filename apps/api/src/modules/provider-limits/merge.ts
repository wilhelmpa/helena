import type { ProviderLimitView } from './service';

// Hermes' Anthropic login reports no account id, so its numbers are stored under a local one
// ("loc-…") next to the owner's own login of the same plan: Claude showed twice (2026-09-24).
// Two views of one provider, one of them local, whose windows end at the same moments (within
// two minutes) are one subscription: they are shown once, with the fresher numbers, the real
// account id and the agents of both.
const SAME_RESET_MS = 120_000;

function resets(account: ProviderLimitView): Map<string, number> {
  return new Map(
    account.windows
      .filter((window) => window.resetsAt)
      .map((window) => [window.id, Date.parse(window.resetsAt as string)]),
  );
}

export function sameSubscription(a: ProviderLimitView, b: ProviderLimitView): boolean {
  if (a.provider !== b.provider || a.account === b.account) return false;
  if (!a.account.startsWith('loc-') && !b.account.startsWith('loc-')) return false;
  const first = resets(a);
  const second = resets(b);
  let matched = 0;
  for (const [id, at] of first) {
    const other = second.get(id);
    if (other === undefined) continue;
    if (Math.abs(at - other) > SAME_RESET_MS) return false;
    matched += 1;
  }
  return matched > 0;
}

function merged(a: ProviderLimitView, b: ProviderLimitView): ProviderLimitView {
  const newer = Date.parse(b.observedAt) > Date.parse(a.observedAt) ? b : a;
  const real = a.account.startsWith('loc-') ? b : a;
  const agents = [...a.agents, ...b.agents].filter(
    (agent, index, all) => all.findIndex((other) => other.id === agent.id) === index,
  );
  return { ...newer, account: real.account, plan: newer.plan ?? a.plan ?? b.plan, agents };
}

export function mergeSameSubscriptions(accounts: ProviderLimitView[]): ProviderLimitView[] {
  const out: ProviderLimitView[] = [];
  for (const account of accounts) {
    const index = out.findIndex((other) => sameSubscription(other, account));
    if (index < 0) out.push(account);
    else out[index] = merged(out[index]!, account);
  }
  return out;
}
