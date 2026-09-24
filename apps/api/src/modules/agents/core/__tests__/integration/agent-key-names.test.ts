import { describe, it, expect, beforeEach } from 'bun:test';
import { apikey, db } from '@repo/db';
import { eq } from 'drizzle-orm';
import { apiKeyApi, authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { bootstrapProjectCoordinator } from '../../../../../scripts/bootstrap-home-agent';

// An agent's key is named "agent:<display name>", and the key plugin refuses a name
// over 32 characters. A display name has no such limit — a template's copy appends the
// project key, a coordinator carries it — so the key's name is cut to fit. Before, a
// long name failed the agent's creation with a 500 and left the agent behind without
// a key, and a re-key deleted the old key before failing on the new one.

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  const project = (await asOwner.projects.post({ key: 'MKT', name: 'Marketing' })).data!;
  return { asOwner, teamId: project.teamId };
}

const agents = (api: Api, teamId: number) => api.teams({ teamId })['ai-agents'];

async function keyNames(userId: string): Promise<string[]> {
  const rows = await db
    .select({ name: apikey.name })
    .from(apikey)
    .where(eq(apikey.referenceId, userId));
  return rows.map((row) => row.name ?? '');
}

async function keyWorks(key: string): Promise<boolean> {
  return (await apiKeyApi(key).projects.get()).status === 200;
}

describe('agent key names', () => {
  beforeEach(resetDb);

  it('creates an agent whose name is longer than a key name may be', async () => {
    const { asOwner, teamId } = await setup();

    const external = await agents(asOwner, teamId).post({
      name: 'Persönlicher Assistent Familie',
      username: 'assistant-fam',
      kind: 'external',
    });
    expect(external.status).toBe(201);
    expect(external.data!.agent.name).toBe('Persönlicher Assistent Familie');
    expect(await keyNames(external.data!.agent.userId)).toEqual([
      'agent:Persönlicher Assistent Fam',
    ]);
    expect(await keyWorks(external.data!.apiKey!)).toBe(true);

    const second = await agents(asOwner, teamId).post({
      name: 'Persönlicher Assistent Privat',
      username: 'assistant-priv',
    });
    expect(second.status).toBe(201);
    expect(await keyNames(second.data!.agent.userId)).toEqual(['agent:Persönlicher Assistent Pri']);
  });

  it('cuts the key name between characters', async () => {
    const { asOwner, teamId } = await setup();

    // Each robot is two UTF-16 code units, which is what the plugin counts. Nine fit
    // after "agent:Agents "; half of a tenth would reach 32.
    const created = await agents(asOwner, teamId).post({
      name: `Agents ${'🤖'.repeat(12)}`,
      username: 'robots',
      kind: 'external',
    });
    expect(created.status).toBe(201);
    expect(await keyNames(created.data!.agent.userId)).toEqual([`agent:Agents ${'🤖'.repeat(9)}`]);
  });

  it('copies a template into projects whose key makes the name too long for a key', async () => {
    const { asOwner, teamId } = await setup();
    const priv = (await asOwner.projects.post({ key: 'PRIV', name: 'Privat' })).data!;
    const verve = (await asOwner.projects.post({ key: 'VERVE', name: 'Verve' })).data!;
    const template = (
      await agents(asOwner, teamId).post({
        name: 'Persönlicher Assistent',
        username: 'assistant',
        kind: 'external',
        template: true,
      })
    ).data!.agent;

    const intoPriv = await agents(
      asOwner,
      teamId,
    )({ agentId: template.id }).copy.post({
      projectId: priv.id,
    });
    expect(intoPriv.status).toBe(201);
    expect(intoPriv.data!.agent).toMatchObject({
      name: 'Persönlicher Assistent PRIV',
      username: 'assistant-priv',
    });
    expect(await keyNames(intoPriv.data!.agent.userId)).toEqual([
      'agent:Persönlicher Assistent PRI',
    ]);
    expect(await keyWorks(intoPriv.data!.apiKey!)).toBe(true);

    const intoVerve = await agents(
      asOwner,
      teamId,
    )({ agentId: template.id }).copy.post({
      projectId: verve.id,
    });
    expect(intoVerve.status).toBe(201);
    expect(intoVerve.data!.agent).toMatchObject({
      name: 'Persönlicher Assistent VERVE',
      username: 'assistant-verve',
    });
    expect(await keyNames(intoVerve.data!.agent.userId)).toEqual([
      'agent:Persönlicher Assistent VER',
    ]);
    expect(await keyWorks(intoVerve.data!.apiKey!)).toBe(true);
  });

  it('regenerates the key of an agent renamed to a long name', async () => {
    const { asOwner, teamId } = await setup();
    const created = (
      await agents(asOwner, teamId).post({ name: 'Bot', username: 'bot', kind: 'external' })
    ).data!;
    const agentId = created.agent.id;
    await agents(asOwner, teamId)({ agentId }).patch({ name: 'Recherche Assistent Volition' });

    const res = await agents(asOwner, teamId)({ agentId })['regenerate-key'].post();
    expect(res.status).toBe(200);
    expect(await keyNames(created.agent.userId)).toEqual(['agent:Recherche Assistent Voliti']);
    expect(await keyWorks(res.data!.apiKey!)).toBe(true);
    expect(await keyWorks(created.apiKey!)).toBe(false);
  });

  it('keys the coordinator of a project with a long key', async () => {
    const { asOwner } = await setup();
    const project = (await asOwner.projects.post({ key: 'HOMEPAGE', name: 'Homepage' })).data!;

    const coordinator = await bootstrapProjectCoordinator(project.id);
    expect(coordinator?.agent.username).toBe('hermes-homepage-coordinator');
    expect(coordinator?.apiKey).toEqual(expect.any(String));
    expect(await keyNames(coordinator!.agent.userId)).toEqual(['agent:Hermes HOMEPAGE Coordinato']);
    expect(await keyWorks(coordinator!.apiKey!)).toBe(true);
  });
});
