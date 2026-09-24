// Switches the browser gateway on for the agents the design names by default
// (docs/volition-design-browser-gateway.md §3: "Standard: an für Coordinator und
// Home-Master"): every team gets the built-in "Projekt-Browser" library entry, and every
// Home-Master and project coordinator gets it turned on. An agent that already has it, or
// that has "Hermes-eigener Browser (alt)" turned on (someone chose the old browser for it),
// is left as it is. Idempotent; run it again after new coordinators were created.
//
//   bun --env-file=<env> apps/api/src/scripts/setup-browser-gateway.ts [--dry-run]
//
// Part of switching the gateway on together with agent isolation (the runbook in the
// orchestrator's report); everything it does can be changed afterwards in Helena, per agent,
// under Agent → Tools.
import {
  agentMcpServer,
  agentMcpServerLink,
  aiAgent,
  db,
  organizationAgentAssignment,
  team,
} from '@repo/db';
import { and, eq, inArray } from 'drizzle-orm';
import { isHomeAgent } from '#modules/agents/core/home-agent';
import {
  BROWSER_GATEWAY_LEGACY_MCP_SERVER_NAME,
  BROWSER_GATEWAY_MCP_SERVER_NAME,
  ensureBuiltinMcpServers,
} from '#modules/agents/mcp-servers/service';

export interface SetupResult {
  teams: number;
  enabled: { teamId: number; agentId: number; username: string; why: 'home' | 'coordinator' }[];
  skipped: { teamId: number; agentId: number; username: string; why: string }[];
}

export async function setupBrowserGateway(dryRun: boolean): Promise<SetupResult> {
  const teams = await db.select({ id: team.id }).from(team);
  const result: SetupResult = { teams: teams.length, enabled: [], skipped: [] };
  for (const { id: teamId } of teams) {
    if (!dryRun) await ensureBuiltinMcpServers(teamId);
    const servers = await db
      .select({ id: agentMcpServer.id, name: agentMcpServer.name })
      .from(agentMcpServer)
      .where(
        and(
          eq(agentMcpServer.teamId, teamId),
          inArray(agentMcpServer.name, [
            BROWSER_GATEWAY_MCP_SERVER_NAME,
            BROWSER_GATEWAY_LEGACY_MCP_SERVER_NAME,
          ]),
        ),
      );
    const gateway = servers.find((row) => row.name === BROWSER_GATEWAY_MCP_SERVER_NAME);
    const legacy = servers.find((row) => row.name === BROWSER_GATEWAY_LEGACY_MCP_SERVER_NAME);

    const agents = await db
      .select({ id: aiAgent.id, username: aiAgent.username })
      .from(aiAgent)
      .where(eq(aiAgent.teamId, teamId));
    const coordinators = new Set(
      (
        await db
          .select({ agentId: organizationAgentAssignment.agentId })
          .from(organizationAgentAssignment)
          .where(
            and(
              eq(organizationAgentAssignment.teamId, teamId),
              eq(organizationAgentAssignment.role, 'coordinator'),
            ),
          )
      ).map((row) => row.agentId),
    );
    const links = await db
      .select({ agentId: agentMcpServerLink.agentId, serverId: agentMcpServerLink.mcpServerId })
      .from(agentMcpServerLink)
      .where(inArray(agentMcpServerLink.agentId, agents.map((agent) => agent.id).concat(-1)));
    const has = (agentId: number, serverId: number | undefined) =>
      serverId !== undefined &&
      links.some((row) => row.agentId === agentId && row.serverId === serverId);

    for (const agent of agents) {
      const why = isHomeAgent(agent.username)
        ? ('home' as const)
        : coordinators.has(agent.id)
          ? ('coordinator' as const)
          : null;
      if (!why) continue;
      if (has(agent.id, gateway?.id)) {
        result.skipped.push({
          teamId,
          agentId: agent.id,
          username: agent.username,
          why: 'already on',
        });
        continue;
      }
      if (has(agent.id, legacy?.id)) {
        result.skipped.push({
          teamId,
          agentId: agent.id,
          username: agent.username,
          why: 'uses the old Hermes browser',
        });
        continue;
      }
      result.enabled.push({ teamId, agentId: agent.id, username: agent.username, why });
      if (!dryRun && gateway) {
        await db
          .insert(agentMcpServerLink)
          .values({ agentId: agent.id, mcpServerId: gateway.id })
          .onConflictDoNothing();
      }
    }
  }
  return result;
}

if (import.meta.main) {
  const dryRun = process.argv.includes('--dry-run');
  const result = await setupBrowserGateway(dryRun);
  const verb = dryRun ? 'would turn on' : 'turned on';
  console.log(`browser gateway: ${result.teams} team(s)`);
  for (const entry of result.enabled) {
    console.log(
      `  ${verb} Projekt-Browser for ${entry.username} (#${entry.agentId}, ${entry.why})`,
    );
  }
  for (const entry of result.skipped) {
    console.log(`  left ${entry.username} (#${entry.agentId}) as it is: ${entry.why}`);
  }
  process.exit(0);
}
