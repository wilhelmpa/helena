import type { Status } from '@/components/common/page/StatusBadge';
import type { AgentLogin, AgentLoginState, SharedLogin } from '@/lib/api/endpoints/accessLogins';
import { loginStatus } from '@/features/home/utils/runtimeLogins';

// How "Anmeldungen" in Zugänge reads a login, in the app's one status vocabulary. An agent's
// login is fine while one reaches its runtime; refused or missing, the owner signs it in
// (again); unknown until its runner has said. A shared login reads as on Start
// (home/utils/runtimeLogins).

const AGENT_STATUS: Record<AgentLoginState, Status> = {
  signedIn: 'success',
  expired: 'danger',
  signedOut: 'danger',
  unknown: 'idle',
};

export function agentLoginStatus(login: Pick<AgentLogin, 'state' | 'online'>): Status {
  return AGENT_STATUS[login.state];
}

// The owner has to act: the runtime has no login that works.
export function agentNeedsOwner(login: Pick<AgentLogin, 'state'>): boolean {
  return login.state === 'expired' || login.state === 'signedOut';
}

export function sharedNeedsOwner(login: Pick<SharedLogin, 'condition' | 'stale'>): boolean {
  return !login.stale && login.condition === 'relogin';
}

export function sharedLoginStatus(login: Pick<SharedLogin, 'condition' | 'stale'>): Status {
  return loginStatus(login.condition, login.stale);
}

// "Pro", "Max": the plan as the runtime names it, capitalized.
export function planLabel(plan: string | null): string | null {
  if (!plan) return null;
  const words = plan.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// The ones the owner has to act on first, then by name.
export function orderedAgentLogins(logins: AgentLogin[]): AgentLogin[] {
  return [...logins].sort(
    (a, b) =>
      Number(agentNeedsOwner(b)) - Number(agentNeedsOwner(a)) || a.name.localeCompare(b.name),
  );
}

export function orderedSharedLogins(logins: SharedLogin[]): SharedLogin[] {
  const rank = (login: SharedLogin) =>
    sharedNeedsOwner(login) ? 0 : login.condition === 'renewFailing' ? 1 : login.managed ? 2 : 3;
  return [...logins].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.provider.localeCompare(b.provider) ||
      a.store.localeCompare(b.store),
  );
}
