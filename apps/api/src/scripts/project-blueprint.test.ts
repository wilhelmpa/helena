import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  aiAgent,
  db,
  helenaSchedule,
  integrationCredentialUse,
  noteBoard,
  organizationGoal,
  project,
  teamMember,
} from '@repo/db';
import { absoluteVaultPath } from '@repo/vault';
import { and, eq } from 'drizzle-orm';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#modules/agents/core/service';
import { createCredential } from '#modules/agents/integrations/service';
import { callConfiguredTool, configuredToolsOf } from '#modules/agents/tools/run';
import { getRunnerAgent } from '#modules/agents/runner/service';
import { runtimePolicySnapshot } from '#modules/agents/runtime-policy/service';
import { getAgentNetwork } from '#modules/agent-egress/service';
import { setEmergencyStop } from '#modules/emergency-stop/service';
import { createDepartment } from '#modules/organization/service';
import { listViewFolders } from '#modules/views/service';
import { readBlueprintDir } from '@helena/sdk/blueprints';
import { readBundleDir } from '@helena/sdk/bundles';
import { runProjectBlueprint } from './project-blueprint';

// The trading blueprint applied end to end on an empty team: the project, its team of
// copies, their network, knowledge, goals and switched-off routines, a second run that has
// nothing left to do, and — once the owner stored the paper keys — the Paper-Trader's tools,
// which run with the stored credential, land in the audit log and stop at the emergency stop.

const REPO = join(import.meta.dir, '../../../..');
const BLUEPRINT = join(REPO, 'blueprints/trading');
const blueprint = readBlueprintDir(BLUEPRINT);
const pool = readBundleDir(join(REPO, 'bundles/agent-pool'));
const quiet = () => {};

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const [membership] = await db
    .select({ teamId: teamMember.teamId })
    .from(teamMember)
    .where(and(eq(teamMember.userId, owner.userId), eq(teamMember.role, 'owner')));
  const teamId = membership!.teamId;
  await createDepartment(teamId, { name: 'Familie & Privat' });
  // The templates the blueprint copies, as the pool import creates them (without skills:
  // the skills are the bundle import's business and not part of this test).
  for (const entry of blueprint.agents) {
    const template = pool.agents.find((agent) => agent.name === entry.template)!;
    await createAgent(teamId, {
      name: template.helena.displayName,
      username: template.name,
      template: true,
      instructions: template.instructions,
      model: null,
      runtimePolicy: {
        reasoningEffort: template.effort,
        toolAllow: [],
        toolDeny: template.disallowedTools,
        mcpGrants: [],
        files: [],
      },
      triggerOnMention: true,
      triggerOnAssign: true,
      runnerScope: 'team',
    });
  }
  return { owner, teamId };
}

async function agentRow(teamId: number, username: string) {
  const [row] = await db
    .select()
    .from(aiAgent)
    .where(and(eq(aiAgent.teamId, teamId), eq(aiAgent.username, username)));
  return row!;
}

describe('the trading blueprint, applied', () => {
  const realFetch = globalThis.fetch;
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('writes nothing in a dry run', async () => {
    const { teamId } = await setup();
    const plan = await runProjectBlueprint({ blueprint: BLUEPRINT, teamId, log: quiet });
    expect(plan.blockers).toEqual([]);
    expect(plan.changes.length).toBeGreaterThan(50);
    const rows = await db.select().from(project).where(eq(project.key, 'TRADE'));
    expect(rows).toEqual([]);
  });

  it('builds the project and its team, and a second run changes nothing', async () => {
    const { teamId } = await setup();
    await runProjectBlueprint({ blueprint: BLUEPRINT, teamId, apply: true, log: quiet });

    const [trade] = await db.select().from(project).where(eq(project.key, 'TRADE'));
    expect(trade!.name).toBe('Trading');
    expect((await listViewFolders(trade!.id)).map((area) => area.folder)).toEqual([
      'aktien',
      'krypto',
      'daytrading',
      'research',
      'strategie-labor',
      'journal-risiko',
    ]);

    // The coordinator got the blueprint's instructions, the copies their assignments.
    const coordinator = await agentRow(teamId, 'hermes-trade-coordinator');
    expect(coordinator.instructions).toBe(blueprint.coordinator!.instructions!);
    const trader = await agentRow(teamId, 'paper-trader-trade');
    expect(trader.template).toBe(false);
    const snapshot = await runtimePolicySnapshot((await getRunnerAgent(trader.userId))!);
    const soul = snapshot.runtimePolicy.files[0]!.content;
    expect(soul).toContain('Kein Echtgeld.');
    expect(soul).toContain('einziger Agent mit Orders, nur im Alpaca-Paper-Konto');

    // The network: live trading hosts denied, the Paper-Trader without a network of its own.
    const network = await getAgentNetwork(trade!.id);
    expect(network.deny).toContain('api.alpaca.markets');
    expect(network.deny).not.toContain('paper-api.alpaca.markets');
    expect(network.agents[String(trader.id)]).toBe('blocked');

    // Knowledge, templates and the board are in the vault.
    expect(existsSync(absoluteVaultPath('Projects/TRADE/Docs/Regelwerk.md'))).toBe(true);
    expect(readFileSync(absoluteVaultPath('Templates/Trading/Trade.md'), 'utf8')).toContain(
      'konto: paper',
    );
    const boards = await db.select().from(noteBoard).where(eq(noteBoard.projectId, trade!.id));
    expect(boards.map((board) => board.name)).toEqual(['Strategie-Labor']);
    expect(existsSync(absoluteVaultPath(boards[0]!.vaultPath!))).toBe(true);

    // Goals of the project, routines switched off.
    const goals = await db
      .select()
      .from(organizationGoal)
      .where(eq(organizationGoal.projectId, trade!.id));
    expect(goals).toHaveLength(blueprint.goals.length);
    const routines = await db
      .select()
      .from(helenaSchedule)
      .where(eq(helenaSchedule.projectId, trade!.id));
    expect(routines).toHaveLength(blueprint.routines.length);
    expect(routines.every((routine) => routine.enabled === false)).toBe(true);

    const again = await runProjectBlueprint({ blueprint: BLUEPRINT, teamId, log: quiet });
    expect(again.changes).toEqual([]);
  });

  it("binds the paper tools once the owner stored the keys, and they run only as Helena's paper tools", async () => {
    const { teamId } = await setup();
    await runProjectBlueprint({ blueprint: BLUEPRINT, teamId, apply: true, log: quiet });
    const credential = await createCredential(teamId, {
      integrationKey: 'alpaca_paper',
      label: 'Alpaca Paper',
      credential: {
        keyId: 'PKTEST1234567890',
        secretKey: 'paper-secret',
        maxOrderValueUsd: 1000,
        maxPositionValueUsd: 2000,
        maxRiskPerTradeUsd: 50,
        dailyLossLimitUsd: 150,
      },
    });
    await runProjectBlueprint({
      blueprint: BLUEPRINT,
      teamId,
      apply: true,
      sections: ['tools'],
      log: quiet,
    });

    const trader = await agentRow(teamId, 'paper-trader-trade');
    const risk = await agentRow(teamId, 'risk-journal-trade');
    const tools = await configuredToolsOf(trader.userId);
    expect([...tools.keys()].sort()).toContain('alpaca_paper_submit_order');
    expect(tools.size).toBe(9);
    expect([...(await configuredToolsOf(risk.userId)).keys()].sort()).toEqual([
      'alpaca_paper_account',
      'alpaca_paper_orders',
      'alpaca_paper_positions',
    ]);

    // A call runs with the stored keys against the paper host only, and is audited.
    const hosts: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url);
      hosts.push(url.hostname);
      const body =
        url.pathname === '/v2/account'
          ? {
              status: 'ACTIVE',
              currency: 'USD',
              cash: '100000',
              equity: '100000',
              last_equity: '100000',
              buying_power: '200000',
              trading_blocked: false,
              account_blocked: false,
            }
          : [];
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    const caller = { userId: trader.userId, auth: { kind: 'api-key' as const, apiKey: 'x' }, runId: null };
    const result = await callConfiguredTool(tools.get('alpaca_paper_account')!, {}, caller);
    expect(result.isError).toBeFalsy();
    expect(hosts.every((host) => host === 'paper-api.alpaca.markets')).toBe(true);
    const uses = await db
      .select()
      .from(integrationCredentialUse)
      .where(eq(integrationCredentialUse.credentialId, credential.id));
    expect(uses.map((use) => use.action)).toEqual(['called']);

    // The emergency stop stops every call but reading.
    const [owner] = await db
      .select({ userId: teamMember.userId })
      .from(teamMember)
      .where(and(eq(teamMember.teamId, teamId), eq(teamMember.role, 'owner')));
    await setEmergencyStop(true, owner!.userId, 'test');
    try {
      const refused = await callConfiguredTool(
        tools.get('alpaca_paper_cancel_order')!,
        { orderId: '11111111-2222-3333-4444-555555555555' },
        caller,
      );
      expect(refused.isError).toBe(true);
      expect(JSON.stringify(refused.content)).toContain('Not-Aus');
    } finally {
      await setEmergencyStop(false, owner!.userId);
    }
  });
});
