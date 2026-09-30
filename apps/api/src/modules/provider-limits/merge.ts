import type { ProviderLimitView } from './service';

export function sameSubscription(a: ProviderLimitView, b: ProviderLimitView): boolean {
  return a.provider === b.provider && a.account === b.account;
}

function merged(a: ProviderLimitView, b: ProviderLimitView): ProviderLimitView {
  const newer = Date.parse(b.observedAt) > Date.parse(a.observedAt) ? b : a;
  const agents = [...a.agents, ...b.agents].filter(
    (agent, index, all) => all.findIndex((other) => other.id === agent.id) === index,
  );
  return { ...newer, plan: newer.plan ?? a.plan ?? b.plan, agents };
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
