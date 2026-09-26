import type { AgentScope } from '#modules/agents/core/service';
import { db, helenaProviderLimit, integrationCredential, integrationCredentialUse } from '@repo/db';
import { runtimeLoginCondition, type RuntimeLoginCondition } from '@helena/sdk';
import { desc, eq, inArray } from 'drizzle-orm';
import { HttpError } from '#shared/lib';
import { getAgentById, listAgents, type AiAgentRow } from '#modules/agents/core/service';
import { runtimeLoginOf } from '#modules/agents/credentials/runtime-login';
import { askRuntime, runtimeRequestConfig } from '#modules/agents/runtime-requests/service';
import { runtimeLogins } from '#modules/runtime-logins/service';
import { runtimeOfPolicy } from '#modules/model-availability/runtime';
import type { AccessLoginsResponse, AgentLoginRow, SharedLoginRow } from './model';

// "Anmeldungen" in Zugänge: every login Helena's agents use, in one place (owner, 2026-09-25:
// "Codex erscheint nicht in den Zugängen, obwohl es angelegt ist"). Three kinds:
//   - stored runtime logins (credentials of kind runtime_login), which Zugänge lists anyway;
//   - the login a Claude Code or Codex agent keeps of its own in its home (a Codex device
//     login): never stored in Helena, since only the runtime may renew it (Codex rotates its
//     refresh token on every use). Its runner reports what the runtime says about it with
//     the agent's runtime state (@helena/sdk runtime-account.ts); read here, checked now and
//     signed out through runtime requests (`login.read`, `login.logout`), which the runner
//     carries out in the agent's own unit;
//   - the model logins every Hermes agent shares, as the token keeper reports them
//     (runtime login sources, runtime-logins/service.ts): instance-wide, so only the owner
//     sees them.
// Names, states and times only: no route here returns a token, and the runner sends none.

type CliRuntime = 'claude' | 'codex';

// The runtime's name in the audit log, the same in every language.
const RUNTIME_NAMES: Record<CliRuntime, string> = { claude: 'Claude Code', codex: 'Codex' };

// How long a person waits for the agent's runner: a check starts the runtime in the agent's
// unit once, a sign-out twice (its sign-out, then a new look).
const CHECK_TIMEOUT_MS = 60_000;
const SIGN_OUT_TIMEOUT_MS = 90_000;

function cliRuntimeOf(agent: Pick<AiAgentRow, 'runtimePolicy'>): CliRuntime | null {
  const runtime = runtimeOfPolicy(agent.runtimePolicy);
  return runtime === 'claude' || runtime === 'codex' ? runtime : null;
}

function online(lastSeenAt: string | null, now: number): boolean {
  if (!lastSeenAt) return false;
  return now - Date.parse(lastSeenAt) <= runtimeRequestConfig.presenceSeconds() * 1000;
}

interface Granted {
  id: number;
  label: string;
}

// The stored runtime login the agent's runtime takes, when one is granted to it: Claude Code
// takes a token or a key, Codex only a key (its ChatGPT login is its own).
async function grantedLogins(
  agents: { agent: AiAgentRow; runtime: CliRuntime }[],
): Promise<Map<number, Granted>> {
  const found = new Map<number, { credentialId: number }>();
  for (const { agent, runtime } of agents) {
    const login = await runtimeLoginOf(agent, null);
    if (!login || login.runtime !== runtime) continue;
    if (runtime === 'codex' && login.method !== 'api_key') continue;
    found.set(agent.id, { credentialId: login.credentialId });
  }
  const ids = [...new Set([...found.values()].map((login) => login.credentialId))];
  const labels = new Map(
    ids.length === 0
      ? []
      : (
          await db
            .select({ id: integrationCredential.id, label: integrationCredential.label })
            .from(integrationCredential)
            .where(inArray(integrationCredential.id, ids))
        ).map((row) => [row.id, row.label ?? ''] as const),
  );
  return new Map(
    [...found].map(([agentId, login]) => [
      agentId,
      { id: login.credentialId, label: labels.get(login.credentialId) ?? '' },
    ]),
  );
}

// One agent's login as Zugänge shows it. Which login the runtime works with: a stored one
// granted to it wins over its own (the runner hands it to each command), then its own.
export function agentLoginRow(
  agent: AiAgentRow,
  runtime: CliRuntime,
  granted: Granted | null,
  viewer: { owner: boolean },
  now = Date.now(),
): AgentLoginRow {
  const state = agent.runtimeState;
  const account = state.account;
  const issue = state.issues.find((entry) => entry.code === 'not-signed-in') ?? null;
  const own = account?.signedIn === true;
  const source: AgentLoginRow['source'] = granted ? 'stored' : own ? 'own' : 'none';
  const status: AgentLoginRow['state'] =
    issue?.detail === 'rejected'
      ? 'expired'
      : issue
        ? 'signedOut'
        : source !== 'none'
          ? 'signedIn'
          : account?.signedIn === false
            ? 'signedOut'
            : 'unknown';
  const seen = online(agent.lastSeenAt, now);
  return {
    agentId: agent.id,
    name: agent.name,
    username: agent.username,
    runtime,
    online: seen,
    source,
    state: status,
    account:
      own && account
        ? {
            method: account.method,
            email: account.email,
            plan: account.plan,
            organization: account.organization,
          }
        : null,
    refreshedAt: own ? (account?.refreshedAt ?? null) : null,
    checkedAt: account?.checkedAt ?? null,
    credential: granted,
    command: account?.command ?? issue?.command ?? null,
    canCheck: seen && state.capabilities.includes('login'),
    canSignOut: viewer.owner && seen && own && state.capabilities.includes('logout'),
  };
}

// The plan each provider's shared login is on, as the plan limits last read it through
// Hermes' logins (provider-limits).
async function sharedPlans(): Promise<Map<string, string>> {
  const rows = await db
    .select({ provider: helenaProviderLimit.provider, plan: helenaProviderLimit.plan })
    .from(helenaProviderLimit)
    .where(eq(helenaProviderLimit.login, 'hermes'))
    .orderBy(desc(helenaProviderLimit.observedAt));
  const plans = new Map<string, string>();
  for (const row of rows)
    if (row.plan && !plans.has(row.provider)) plans.set(row.provider, row.plan);
  return plans;
}

export async function sharedLoginRows(): Promise<SharedLoginRow[]> {
  const [health, plans] = await Promise.all([runtimeLogins(), sharedPlans()]);
  return health.reports.flatMap((report) =>
    report.logins.map((login) => {
      const condition: RuntimeLoginCondition = runtimeLoginCondition(login);
      return {
        key: `${report.source}:${report.reporter}:${login.store}:${login.provider}:${login.id}`,
        store: login.store,
        provider: login.provider,
        label: login.label,
        managed: login.managed,
        state: login.state,
        condition,
        expiresAt: login.expiresAt,
        refreshedAt: login.refreshedAt,
        error: login.error,
        command: login.command,
        note: login.note,
        plan: login.store === 'hermes' ? (plans.get(login.provider) ?? null) : null,
        stale: report.stale,
        checkedAt: report.checkedAt,
      } satisfies SharedLoginRow;
    }),
  );
}

export async function listAccessLogins(
  teamId: number,
  viewer: { owner: boolean; visibleTo: AgentScope | undefined },
): Promise<AccessLoginsResponse> {
  const agents = (await listAgents(teamId, undefined, viewer.visibleTo))
    .filter((agent) => agent.kind === 'external' && !agent.template)
    .flatMap((agent) => {
      const runtime = cliRuntimeOf(agent);
      return runtime ? [{ agent, runtime }] : [];
    });
  const granted = await grantedLogins(agents);
  const now = Date.now();
  return {
    agents: agents
      .map(({ agent, runtime }) =>
        agentLoginRow(agent, runtime, granted.get(agent.id) ?? null, viewer, now),
      )
      .sort((a, b) => a.name.localeCompare(b.name)),
    shared: viewer.owner ? await sharedLoginRows() : null,
  };
}

async function cliAgent(
  teamId: number,
  agentId: number,
  visibleTo: AgentScope | undefined,
): Promise<{ agent: AiAgentRow; runtime: CliRuntime }> {
  const agent = await getAgentById(agentId, teamId, visibleTo);
  const runtime = agent && !agent.template ? cliRuntimeOf(agent) : null;
  if (!agent || !runtime) throw new HttpError(404, 'No Claude Code or Codex agent of that id');
  return { agent, runtime };
}

async function rowOf(
  teamId: number,
  agentId: number,
  viewer: { owner: boolean; visibleTo: AgentScope | undefined },
): Promise<AgentLoginRow> {
  const { agent, runtime } = await cliAgent(teamId, agentId, viewer.visibleTo);
  const granted = await grantedLogins([{ agent, runtime }]);
  return agentLoginRow(agent, runtime, granted.get(agent.id) ?? null, viewer);
}

// "Prüfen": the agent's runner asks the runtime now (after the owner signed it in, say).
export async function checkAgentLogin(
  teamId: number,
  agentId: number,
  viewer: { owner: boolean; visibleTo: AgentScope | undefined; userId: string },
): Promise<AgentLoginRow> {
  const { agent } = await cliAgent(teamId, agentId, viewer.visibleTo);
  if (!agent.runtimeState.capabilities.includes('login')) {
    throw new HttpError(409, "The agent's runner cannot read its login yet");
  }
  // The runner reports the new look with the agent's state before it answers.
  await askRuntime(
    agentId,
    { op: 'login.read' },
    {
      userId: viewer.userId,
      timeoutMs: CHECK_TIMEOUT_MS,
    },
  );
  return rowOf(teamId, agentId, viewer);
}

// "Abmelden": the runtime's own sign-out, run by the agent's runner as the user the agent
// runs as (`codex logout`); the login file is never opened. Written to the access log.
export async function signOutAgentLogin(
  teamId: number,
  agentId: number,
  viewer: { owner: boolean; visibleTo: AgentScope | undefined; userId: string },
  person: { name?: string | null; email?: string | null },
): Promise<AgentLoginRow> {
  const { agent, runtime } = await cliAgent(teamId, agentId, viewer.visibleTo);
  if (!agent.runtimeState.capabilities.includes('logout')) {
    throw new HttpError(409, "The agent's runner cannot sign its runtime out");
  }
  await askRuntime(
    agentId,
    { op: 'login.logout' },
    {
      userId: viewer.userId,
      timeoutMs: SIGN_OUT_TIMEOUT_MS,
    },
  );
  await db.insert(integrationCredentialUse).values({
    teamId,
    credentialId: null,
    credentialLabel: `${RUNTIME_NAMES[runtime]} · ${agent.name}`.slice(0, 200),
    agentId: null,
    agentName: person.name || person.email || '',
    action: 'changed',
    purpose: 'signed-out',
  });
  return rowOf(teamId, agentId, viewer);
}
