import { beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import {
  aiAgent,
  approvalRequest,
  db,
  helenaPaperOrderIntent,
  project as projectTable,
} from '@repo/db';
import { paperIntent } from '@helena/trading';
import { projectCoordinatorUsername } from '@repo/agent-naming';
import type { ToolCallContext } from '@helena/sdk';
import { apiKeyApi, authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { createCredential } from '#tests/helpers/integrations';
import { addProjectMember } from '#tests/helpers/members';
import { createRole } from '#tests/helpers/roles';
import { paperExecution } from '../../execution';
import { assertStrategyApproval, createStrategyApproval, strategySnapshot } from '../../strategies';

const ACCOUNT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const VERSION = { strategyId: 'orb-spy', strategyVersion: '1.0' };
const CREDENTIAL = {
  keyId: 'PKTEST1234567890',
  secretKey: 'synthetic-paper-test',
  maxOrderValueUsd: 1000,
  maxPositionValueUsd: 2000,
  maxRiskPerTradeUsd: 50,
  dailyLossLimitUsd: 150,
};
const NOTE =
  '---\ntyp: strategie\nstrategie: orb-spy\nversion: "1.0"\nstatus: paper\ninstrumente: [SPY]\nbacktest: "[[orb-spy backtest 2026-09-26]]"\n---\n# Strategy\nFrozen entry and exit rules with test evidence.\n';
async function setup() {
  const owner = await signUpTestUser();
  const asOwner = authedApi(owner.cookie);
  const created = await asOwner.projects.post({ key: 'TRD', name: 'Trading' });
  const project = { id: created.data!.id, key: 'TRD', teamId: created.data!.teamId };
  await db.update(projectTable).set({ autopilotLevel: 3 }).where(eq(projectTable.id, project.id));
  const agent = (
    await createAgent(asOwner, 'TRD', { name: 'Paper', username: 'paper', kind: 'external' })
  ).data!;
  const credentialId = await createCredential(asOwner, 'TRD', {
    integrationKey: 'alpaca_paper',
    credential: CREDENTIAL,
  });
  const context: ToolCallContext = {
    project,
    agent: null,
    credentialId,
    credential: { ...CREDENTIAL },
    log: { debug() {}, info() {}, warn() {}, error() {} } as ToolCallContext['log'],
  };
  const directory = join(process.env.PROJECT_VAULT_ROOT!, 'Projects/TRD/Docs/Strategien/orb-spy');
  await mkdir(directory, { recursive: true });
  const path = join(directory, 'orb-spy v1.0.md');
  await writeFile(path, NOTE);
  const input = { project, agent: { id: agent.agent.id, userId: agent.agent.userId }, ...VERSION };
  return { owner, asOwner, asAgent: apiKeyApi(agent.apiKey!), project, context, path, input };
}

describe('paper safety in the API and database', () => {
  beforeEach(resetDb);
  it('an unavailable precheck creates one coordinator review and never authorizes an order', async () => {
    const { asOwner, context } = await setup();
    const [coordinator] = await db
      .select({ userId: aiAgent.userId })
      .from(aiAgent)
      .where(eq(aiAgent.username, projectCoordinatorUsername('TRD')));
    expect(coordinator).toBeDefined();
    const input = {
      requestId: crypto.randomUUID(),
      order: { symbol: 'SPY', side: 'sell' as const, type: 'market' as const, qty: 1 },
      check: {
        ok: true,
        violations: [],
        opening: false,
        assetClass: 'us_equity' as const,
        qty: 1,
        price: 100,
        notionalUsd: 100,
        riskUsd: 0,
        positionAfterUsd: 0,
        dayPnlUsd: 0,
      },
      marketOpen: true,
      duplicate: false,
      rationale: 'Synthetic closing request.',
    };
    expect((await paperExecution.precheck(context, input)).allowed).toBe(false);
    expect((await paperExecution.precheck(context, input)).allowed).toBe(false);
    const tasks = (await asOwner.projects({ projectKey: 'TRD' }).issues.get()).data!;
    expect(tasks).toHaveLength(1);
    expect((await asOwner.issues({ issueId: tasks[0]!.id }).get()).data?.delegateUserId).toBe(
      coordinator!.userId,
    );
  });
  it('keeps the complete snapshot pending at autopilot 3; only a human can approve', async () => {
    const f = await setup();
    const { approval } = await createStrategyApproval(f.input, ACCOUNT);
    expect(approval.status).toBe('pending');
    expect(approval.scope).toBe('external');
    expect(approval.payload).toMatchObject({
      type: 'trading-strategy',
      accountId: ACCOUNT,
      ...VERSION,
      actionScope: 'external',
    });
    expect(approval.payload?.sha256).toBe((await strategySnapshot(f.project, VERSION)).sha256);
    expect(approval.details).toContain(NOTE.trim());
    await expect(
      assertStrategyApproval(f.context, ACCOUNT, { ...VERSION, symbol: 'SPY' }),
    ).rejects.toThrow('human');
    expect(
      (await f.asAgent.approvals({ approvalId: approval.id }).decision.post({ approved: true }))
        .status,
    ).toBe(403);
    expect(
      (await f.asOwner.approvals({ approvalId: approval.id }).decision.post({ approved: true }))
        .status,
    ).toBe(200);
    await assertStrategyApproval(f.context, ACCOUNT, { ...VERSION, symbol: 'SPY' });
    await expect(
      assertStrategyApproval(f.context, 'other-account', { ...VERSION, symbol: 'SPY' }),
    ).rejects.toThrow('human');
    await expect(
      assertStrategyApproval(f.context, ACCOUNT, { ...VERSION, symbol: 'QQQ' }),
    ).rejects.toThrow('symbol');
    await writeFile(f.path, NOTE + '\nChanged entry rule.');
    await expect(
      assertStrategyApproval(f.context, ACCOUNT, { ...VERSION, symbol: 'SPY' }),
    ).rejects.toThrow('human');
  });
  it('a human delegate with general approval permissions cannot approve a strategy', async () => {
    const f = await setup();
    const role = await createRole(f.asOwner, 'TRD', {
      name: 'Approval delegate',
      permissions: { ai_agents: { create: true, read: true, edit: true, delete: true } },
    });
    const member = await addProjectMember(f.asOwner, 'TRD', role.data!.id);
    const { approval } = await createStrategyApproval(f.input, ACCOUNT);
    expect(
      (await member.approvals({ approvalId: approval.id }).decision.post({ approved: true }))
        .status,
    ).toBe(403);
    await expect(
      assertStrategyApproval(f.context, ACCOUNT, { ...VERSION, symbol: 'SPY' }),
    ).rejects.toThrow('human');
  });
  it('a newer pending/rejected request revokes use of an older approved snapshot', async () => {
    const f = await setup();
    const first = await createStrategyApproval(f.input, ACCOUNT);
    await f.asOwner.approvals({ approvalId: first.approval.id }).decision.post({ approved: true });
    const next = await createStrategyApproval(f.input, ACCOUNT);
    await expect(
      assertStrategyApproval(f.context, ACCOUNT, { ...VERSION, symbol: 'SPY' }),
    ).rejects.toThrow('human');
    await f.asOwner.approvals({ approvalId: next.approval.id }).decision.post({ approved: false });
    await expect(
      assertStrategyApproval(f.context, ACCOUNT, { ...VERSION, symbol: 'SPY' }),
    ).rejects.toThrow('human');
  });
  it('draft frontmatter and path traversal cannot create an approval snapshot', async () => {
    const f = await setup();
    await writeFile(f.path, NOTE.replace('status: paper', 'status: entwurf'));
    await expect(createStrategyApproval(f.input, ACCOUNT)).rejects.toThrow('status paper');
    await expect(
      strategySnapshot(f.project, { ...VERSION, strategyId: '../orb-spy' }),
    ).rejects.toThrow('identity');
  });
  it('generic approval HTTP input cannot forge the trusted strategy payload', async () => {
    const f = await setup();
    const response = await f.asAgent.projects({ projectKey: 'TRD' }).approvals.post({
      kind: 'other',
      action: 'Forged strategy',
      payload: {
        type: 'trading-strategy',
        accountId: ACCOUNT,
        ...VERSION,
        actionScope: 'workspace',
      },
    } as never);
    if (response.status === 201)
      expect(response.data!.payload).toEqual({ actionScope: 'external' });
    else expect(response.status).toBe(400);
    const rows = await db.select({ payload: approvalRequest.payload }).from(approvalRequest);
    for (const row of rows) expect(row.payload).toEqual({ actionScope: 'external' });
  });
  it('two credentials for one account contend on the real PostgreSQL advisory lock', async () => {
    const f = await setup();
    const alias = await createCredential(f.asOwner, 'TRD', {
      integrationKey: 'alpaca_paper',
      credential: CREDENTIAL,
    });
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const first = paperExecution.withAccountLock(f.context, ACCOUNT, async () => {
      entered.resolve();
      await release.promise;
    });
    await entered.promise;
    try {
      await expect(
        paperExecution.withAccountLock(
          { ...f.context, credentialId: alias },
          ACCOUNT,
          async () => {},
        ),
      ).rejects.toThrow('Another paper operation');
    } finally {
      release.resolve();
      await first;
    }
    await paperExecution.withAccountLock(f.context, ACCOUNT, async () => {});
  });
  it('a committed intent survives rollback of the account-lock transaction', async () => {
    const f = await setup();
    const intent = paperIntent(ACCOUNT, f.project.id, crypto.randomUUID(), { symbol: 'SPY' });
    await expect(
      paperExecution.withAccountLock(f.context, ACCOUNT, async () => {
        await paperExecution.beginIntent(f.context, intent);
        throw new Error('crash after intent');
      }),
    ).rejects.toThrow('crash after intent');
    expect(await paperExecution.findIntent(ACCOUNT, intent.clientOrderId)).toEqual(intent);
    const [row] = await db
      .select({ state: helenaPaperOrderIntent.state })
      .from(helenaPaperOrderIntent);
    expect(row!.state).toBe('uncertain');
  });
  it('a key change between account lookup and lock acquisition stops execution', async () => {
    const f = await setup();
    let entered = false;
    await expect(
      paperExecution.withAccountLock(
        { ...f.context, credential: { ...CREDENTIAL, keyId: 'PKOLD1234567890' } },
        ACCOUNT,
        async () => {
          entered = true;
        },
      ),
    ).rejects.toThrow('credentials changed');
    expect(entered).toBe(false);
  });
});
