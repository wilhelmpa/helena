import { agentChatCatalog, aiAgent, db, helenaModelAvailability, user } from '@repo/db';
import type { RuntimeLogin, RuntimeLoginState } from '@helena/sdk';
import { eq } from 'drizzle-orm';
import { runtimeLogins } from '#modules/runtime-logins/service';
import { runtimeOfPolicy } from './runtime';

// Agents whose model runs through a Hermes login the provider rejected
// (docs/helena-decisions/model-availability.md §7, with the token keeper's status,
// docs/helena-decisions/token-keeper.md): they fail until the owner signs Hermes in again or
// gives them a model of another provider. The keeper's catalog change already leaves such a
// provider's models out of the pickers; this names the agents still set to one.

// A login agents cannot use now: the provider rejected it, or its access token ran out and
// was not renewed. (One that failed to renew for now, 'error', still works until it expires.)
function lost(login: Pick<RuntimeLogin, 'state'>): boolean {
  return login.state === 'invalid' || login.state === 'expired';
}

export interface DeadLogin {
  provider: string;
  state: RuntimeLoginState;
  // What the owner runs in the owner terminal to sign Hermes in again.
  command: string | null;
}

// The providers every one of whose Hermes logins is lost, from reports that are not stale.
export async function deadHermesLogins(): Promise<DeadLogin[]> {
  const health = await runtimeLogins();
  const byProvider = new Map<string, RuntimeLogin[]>();
  for (const report of health.reports) {
    if (report.stale) continue;
    for (const login of report.logins) {
      if (login.store !== 'hermes') continue;
      byProvider.set(login.provider, [...(byProvider.get(login.provider) ?? []), login]);
    }
  }
  return [...byProvider]
    .filter(([, logins]) => logins.length > 0 && logins.every(lost))
    .map(([provider, logins]) => ({
      provider,
      state: logins[0]!.state,
      command: logins.find((login) => login.command)?.command ?? null,
    }));
}

// The provider a model runs through: the agent's runner catalog names it; else what Helena
// learned about the model; else the model's family.
export function providerOfModel(
  model: string,
  catalog: Map<string, string>,
  learned: Map<string, string>,
): string | null {
  const known = catalog.get(model) ?? learned.get(model);
  if (known) return known;
  const id = model.toLowerCase().replace(/^.*\//, '');
  if (/^(claude|opus|sonnet|haiku|fable)\b/.test(id)) return 'anthropic';
  if (/^(gpt|o\d|codex)/.test(id)) return 'openai-codex';
  return null;
}

export interface AgentOnDeadLogin {
  id: number;
  teamId: number;
  username: string;
  name: string;
  template: boolean;
  model: string | null;
  provider: string;
}

// The Hermes agents (and templates) whose model, or whose runtime's default model, runs
// through a lost login.
async function agentsOnDeadLogins(dead: DeadLogin[], teamId?: number): Promise<AgentOnDeadLogin[]> {
  if (dead.length === 0) return [];
  const providers = new Set(dead.map((login) => login.provider));
  const [agents, catalogs, learned] = await Promise.all([
    db
      .select({
        id: aiAgent.id,
        teamId: aiAgent.teamId,
        username: aiAgent.username,
        name: user.name,
        template: aiAgent.template,
        model: aiAgent.model,
        runtimePolicy: aiAgent.runtimePolicy,
        runtimeState: aiAgent.runtimeState,
      })
      .from(aiAgent)
      .innerJoin(user, eq(user.id, aiAgent.userId))
      .where(teamId === undefined ? undefined : eq(aiAgent.teamId, teamId)),
    db
      .select({ agentId: agentChatCatalog.agentId, models: agentChatCatalog.models })
      .from(agentChatCatalog),
    db
      .select({ model: helenaModelAvailability.model, provider: helenaModelAvailability.provider })
      .from(helenaModelAvailability),
  ]);
  const learnedProviders = new Map(
    learned.filter((row) => row.provider).map((row) => [row.model, row.provider]),
  );
  const catalogOf = new Map(
    catalogs.map((row) => [
      row.agentId,
      new Map(
        ((row.models as { id: string; provider?: string }[] | null) ?? [])
          .filter((entry) => entry.provider)
          .map((entry) => [entry.id, entry.provider!]),
      ),
    ]),
  );
  const found: AgentOnDeadLogin[] = [];
  for (const agent of agents) {
    if (runtimeOfPolicy(agent.runtimePolicy) !== 'hermes') continue;
    const provider = agent.model
      ? providerOfModel(agent.model, catalogOf.get(agent.id) ?? new Map(), learnedProviders)
      : ((agent.runtimeState as { profile?: { defaults?: { provider?: string | null } } } | null)
          ?.profile?.defaults?.provider ?? null);
    if (!provider || !providers.has(provider)) continue;
    found.push({
      id: agent.id,
      teamId: agent.teamId,
      username: agent.username,
      name: agent.name,
      template: agent.template,
      model: agent.model,
      provider,
    });
  }
  return found;
}

// Each lost login with the agents that run through it, for the health overview (all teams)
// and a team's agent editor.
export async function deadLoginsWithAgents(teamId?: number) {
  const dead = await deadHermesLogins();
  const agents = await agentsOnDeadLogins(dead, teamId);
  return dead.map((login) => ({
    ...login,
    agents: agents
      .filter((agent) => agent.provider === login.provider)
      .map(({ id, teamId: team, username, name, template, model }) => ({
        id,
        teamId: team,
        username,
        name,
        template,
        model,
      })),
  }));
}
