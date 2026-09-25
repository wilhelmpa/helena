import { request } from '@/lib/api/core/client';
import type { RuntimeLoginCondition } from '@helena/sdk/web';
import type { RuntimeLoginState } from './god';

// "Anmeldungen" in Zugänge: every login the agents use. A Claude Code or Codex agent's own
// login in its home (a Codex device login), or the stored runtime login granted to it; for
// the owner also the model logins every Hermes agent shares. Names, states and times only:
// no token ever arrives here.

export type AgentLoginState = 'signedIn' | 'expired' | 'signedOut' | 'unknown';

export interface AgentLogin {
  agentId: number;
  name: string;
  username: string;
  runtime: 'claude' | 'codex';
  // Whether the agent's runner was seen lately.
  online: boolean;
  // The login the runtime works with: its own, a stored one granted to it (which wins), none.
  source: 'own' | 'stored' | 'none';
  state: AgentLoginState;
  // The runtime's own login, as the runtime names its account.
  account: {
    method: string | null;
    email: string | null;
    plan: string | null;
    organization: string | null;
  } | null;
  // When the runtime last wrote its own login (signed in, renewed it).
  refreshedAt: string | null;
  // When the runner last asked the runtime.
  checkedAt: string | null;
  credential: { id: number; label: string } | null;
  // What the owner runs in the owner terminal to sign the runtime in (again).
  command: string | null;
  canCheck: boolean;
  canSignOut: boolean;
}

export interface SharedLogin {
  key: string;
  store: string;
  provider: string;
  label: string | null;
  managed: boolean;
  state: RuntimeLoginState;
  condition: RuntimeLoginCondition;
  expiresAt: string | null;
  refreshedAt: string | null;
  error: string | null;
  command: string | null;
  note: string | null;
  plan: string | null;
  stale: boolean;
  checkedAt: string;
}

export interface AccessLogins {
  agents: AgentLogin[];
  // Null for anyone but the owner.
  shared: SharedLogin[] | null;
}

export const listAccessLogins = (teamId: number) =>
  request<AccessLogins>(`/teams/${teamId}/access/logins`);

export const checkAgentLogin = (teamId: number, agentId: number) =>
  request<AgentLogin>(`/teams/${teamId}/access/logins/agents/${agentId}/check`, {
    method: 'POST',
  });

export const signOutAgentLogin = (teamId: number, agentId: number) =>
  request<AgentLogin>(`/teams/${teamId}/access/logins/agents/${agentId}/sign-out`, {
    method: 'POST',
  });
