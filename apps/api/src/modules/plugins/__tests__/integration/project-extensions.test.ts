import { beforeEach, describe, expect, it } from 'bun:test';
import { db, integrationCredentialGrant } from '@repo/db';
import { authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { addProjectMember } from '#tests/helpers/members';
import { createAgent } from '#tests/helpers/agents';
import { credentialValues } from '#modules/agents/integrations/service';

// Projekt › Einstellungen › Erweiterungen: a plugin's settings for one project, read from
// its connector's fields. Here the trading plugin's Alpaca paper connection: its limits are
// shown and saved, its keys never leave the store, and a connection of another project is
// out of reach.

const PAPER = {
  keyId: 'PKTEST00000000000001',
  secretKey: 'paper-secret-value-4321',
  maxOrderValueUsd: 1000,
  maxPositionValueUsd: 2000,
  maxRiskPerTradeUsd: 50,
  dailyLossLimitUsd: 150,
  maxOrdersPerDay: 20,
  allowCrypto: false,
  tradingHalted: true,
};

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  const trade = await asOwner.projects.post({ key: 'TRADE', name: 'Trading' });
  const other = await asOwner.projects.post({ key: 'OTHER', name: 'Other' });
  const teamId = trade.data!.teamId;
  const created = await asOwner.teams({ teamId }).integrations.post({
    integrationKey: 'alpaca_paper',
    label: 'Paper',
    credential: PAPER,
  });
  expect(created.status).toBe(201);
  return {
    asOwner,
    teamId,
    tradeId: trade.data!.id,
    otherId: other.data!.id,
    credentialId: created.data!.id,
  };
}

describe('project extensions', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('lists nothing for a project without a connection of a plugin', async () => {
    const { asOwner } = await setup();
    const res = await asOwner.projects({ projectKey: 'TRADE' }).extensions.get();
    expect(res.status).toBe(200);
    expect(res.data).toEqual([]);
  });

  it("shows a granted connection's settings and only whether its secret is set", async () => {
    const { asOwner, tradeId, credentialId } = await setup();
    await db.insert(integrationCredentialGrant).values({ credentialId, projectId: tradeId });

    const res = await asOwner.projects({ projectKey: 'TRADE' }).extensions.get();
    expect(res.status).toBe(200);
    const plugin = res.data!.find((entry) => entry.id === 'helena.trading');
    expect(plugin).toBeDefined();
    const connector = plugin!.connectors.find((entry) => entry.id === 'alpaca_paper')!;
    expect(connector.fields.map((field) => field.key)).toContain('maxOrderValueUsd');
    const [connection] = connector.connections;
    expect(connection).toMatchObject({
      id: credentialId,
      label: 'Paper',
      secrets: { secretKey: true },
      values: { maxOrderValueUsd: 1000, allowCrypto: false, tradingHalted: true },
    });
    expect(connection!.values).not.toHaveProperty('secretKey');
    // Not even the masked tail of the secret.
    expect(JSON.stringify(res.data)).not.toContain('4321');

    // Another project does not see it.
    const other = await asOwner.projects({ projectKey: 'OTHER' }).extensions.get();
    expect(other.data).toEqual([]);
  });

  it("counts a connection granted to one of the project's agents", async () => {
    const { asOwner, credentialId } = await setup();
    const agent = await createAgent(asOwner, 'TRADE', { name: 'Paper Trader', username: 'paper' });
    expect(agent.status).toBe(201);
    await db
      .insert(integrationCredentialGrant)
      .values({ credentialId, agentId: agent.data!.agent.id });
    const res = await asOwner.projects({ projectKey: 'TRADE' }).extensions.get();
    expect(res.data!.map((entry) => entry.id)).toEqual(['helena.trading']);
  });

  it('saves the limits, keeps the keys and refuses a secret', async () => {
    const { asOwner, teamId, tradeId, credentialId } = await setup();
    await db.insert(integrationCredentialGrant).values({ credentialId, projectId: tradeId });
    const route = asOwner
      .projects({ projectKey: 'TRADE' })
      .extensions.connections({ credentialId });

    const saved = await route.patch({
      values: { maxOrderValueUsd: 500, allowCrypto: true, allowedSymbols: 'SPY, QQQ' },
    });
    expect(saved.status).toBe(200);
    expect(saved.data).toMatchObject({
      values: { maxOrderValueUsd: 500, allowCrypto: true, allowedSymbols: 'SPY, QQQ' },
      secrets: { secretKey: true },
    });
    const stored = await credentialValues(credentialId, teamId);
    expect(stored).toMatchObject({
      keyId: PAPER.keyId,
      secretKey: PAPER.secretKey,
      maxOrderValueUsd: 500,
      dailyLossLimitUsd: 150,
      allowCrypto: true,
    });

    const secret = await route.patch({ values: { secretKey: 'replaced' } });
    expect(secret.status).toBe(400);
    const unknown = await route.patch({ values: { somethingElse: 1 } });
    expect(unknown.status).toBe(400);
    expect((await credentialValues(credentialId, teamId))?.secretKey).toBe(PAPER.secretKey);
  });

  it("refuses another project's connection and a plain member", async () => {
    const { asOwner, tradeId, credentialId } = await setup();
    await db.insert(integrationCredentialGrant).values({ credentialId, projectId: tradeId });

    const foreign = await asOwner
      .projects({ projectKey: 'OTHER' })
      .extensions.connections({ credentialId })
      .patch({ values: { maxOrderValueUsd: 1 } });
    expect(foreign.status).toBe(404);

    const member = await addProjectMember(asOwner, 'TRADE');
    const listed = await member.projects({ projectKey: 'TRADE' }).extensions.get();
    expect(listed.status).toBe(403);
    const patched = await member
      .projects({ projectKey: 'TRADE' })
      .extensions.connections({ credentialId })
      .patch({ values: { maxOrderValueUsd: 1 } });
    expect(patched.status).toBe(403);
  });

  it('names the projects of each plugin for the Administrator', async () => {
    const { asOwner, tradeId, credentialId } = await setup();
    await db.insert(integrationCredentialGrant).values({ credentialId, projectId: tradeId });
    const res = await asOwner.god.plugins.projects.get();
    expect(res.status).toBe(200);
    expect(res.data!['helena.trading']).toEqual([{ key: 'TRADE', name: 'Trading' }]);
  });
});
