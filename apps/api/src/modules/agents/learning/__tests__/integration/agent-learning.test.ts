import { describe, it, expect, beforeEach } from 'bun:test';
import { createHash } from 'node:crypto';
import { apiKeyApi, authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { addProjectMember } from '#tests/helpers/members';
import { createRole } from '#tests/helpers/roles';
import { createAgent } from '#tests/helpers/agents';
import { untaggedRoutes } from '#tests/helpers/mcp';

// What an external agent learned in its Hermes runtime: its runner reports the skills the
// agent created and its memory, the owner decides on them in Plan, and the runner receives
// those decisions with the runtime policy and reports back how each went.

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

const webScrape = {
  path: 'research/web-scrape',
  name: 'web-scrape',
  markdown: '---\nname: web-scrape\ndescription: Scrape a site politely\n---\n\n# Web scrape\n',
  files: [{ path: 'references/sites.md', content: '# Sites' }],
  otherFiles: 0,
  truncated: false,
};

const inventory = {
  toolsets: ['file', 'memory', 'skills'],
  mcpServers: ['itsaplan'],
  skills: [
    {
      name: 'web-scrape',
      category: 'research',
      description: 'Scrape a site politely',
      origin: 'agent' as const,
      path: 'research/web-scrape',
      pinned: false,
    },
    {
      name: 'airtable',
      category: 'productivity',
      description: 'Airtable',
      origin: 'bundled' as const,
      path: 'productivity/airtable',
      pinned: false,
    },
  ],
  memory: [
    {
      file: 'MEMORY.md' as const,
      content: 'Uses bun.',
      truncated: false,
      sha256: sha256('Uses bun.'),
      chars: 9,
    },
    { file: 'USER.md' as const, content: '', truncated: false, sha256: sha256(''), chars: 0 },
  ],
  cronJobs: 0,
};

const status = {
  adapter: 'hermes',
  status: 'online' as const,
  appliedRevision: null,
  capabilities: ['learning'],
  detail: null,
};

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  const project = await asOwner.projects.post({ key: 'MKT', name: 'Marketing' });
  const created = await createAgent(asOwner, 'MKT', {
    name: 'Researcher',
    username: 'researcher',
    kind: 'external',
  });
  return {
    asOwner,
    teamId: project.data!.teamId,
    agentId: created.data!.agent.id,
    asRunner: apiKeyApi(created.data!.apiKey!),
  };
}

const agentRoute = (api: Api, teamId: number, agentId: number) =>
  api.teams({ teamId })['ai-agents']({ agentId });

async function report(asRunner: Api, extra: Record<string, unknown> = {}) {
  return asRunner['agent-runtime'].status.post({
    ...status,
    inventory,
    learnedSkills: [webScrape],
    ...extra,
  } as Parameters<Api['agent-runtime']['status']['post']>[0]);
}

describe('agent learning', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('lets the agent learn by default, keeps the curator off, and says so in the policy', async () => {
    const { asOwner, asRunner, teamId, agentId } = await setup();

    const before = await asRunner['agent-runtime'].policy.get();
    expect(before.data!.learning).toEqual({ enabled: true, curator: false });
    expect(before.data!.actions).toEqual([]);
    expect(
      (await agentRoute(asOwner, teamId, agentId).get()).data!.runtimePolicy,
    ).not.toHaveProperty('learning');

    const patched = await agentRoute(asOwner, teamId, agentId).patch({
      runtimePolicy: {
        reasoningEffort: null,
        toolAllow: [],
        toolDeny: [],
        mcpGrants: [],
        files: [],
        learning: false,
        curator: true,
      },
    });
    expect(patched.data!.runtimePolicy).toMatchObject({ learning: false, curator: true });

    const after = await asRunner['agent-runtime'].policy.get();
    expect(after.data!.learning).toEqual({ enabled: false, curator: true });
    expect(after.data!.revision).not.toBe(before.data!.revision);

    const refused = await agentRoute(asOwner, teamId, agentId).patch({
      runtimePolicy: {
        reasoningEffort: null,
        toolAllow: [],
        toolDeny: [],
        mcpGrants: [],
        files: [],
        learning: 'yes' as unknown as boolean,
      },
    });
    expect(refused.status).toBe(400);
  });

  it('stores what the runner reports and shows a learned skill with its content', async () => {
    const { asOwner, asRunner, teamId, agentId } = await setup();

    const res = await report(asRunner, { restored: ['plugins/plan-approval-guard'] });
    expect(res.status).toBe(200);

    const agent = (await agentRoute(asOwner, teamId, agentId).get()).data!;
    expect(agent.runtimeState.inventory).toEqual(inventory);
    expect(agent.runtimeState.restored).toEqual(['plugins/plan-approval-guard']);
    // The content stays out of every read of the agent.
    expect(JSON.stringify(agent)).not.toContain('# Sites');

    const content = await agentRoute(asOwner, teamId, agentId)['learned-skills'].content.get({
      query: { path: 'research/web-scrape' },
    });
    expect(content.status).toBe(200);
    expect(content.data).toEqual(webScrape);
    const missing = await agentRoute(asOwner, teamId, agentId)['learned-skills'].content.get({
      query: { path: 'research/other' },
    });
    expect(missing.status).toBe(404);

    const tooMany = await report(asRunner, {
      learnedSkills: Array.from({ length: 51 }, (_, index) => ({
        ...webScrape,
        path: `s${index}`,
      })),
    });
    expect(tooMany.status).toBe(400);
    const tooLarge = await report(asRunner, {
      learnedSkills: Array.from({ length: 40 }, (_, index) => ({
        ...webScrape,
        path: `s${index}`,
        markdown: 'x'.repeat(60_000),
      })),
    });
    expect(tooLarge.status).toBe(413);
  });

  it('queues actions for the runner, hands them over with the policy and records how they went', async () => {
    const { asOwner, asRunner, teamId, agentId } = await setup();
    const actions = () => agentRoute(asOwner, teamId, agentId)['runtime-actions'];

    const early = await actions().post({ kind: 'discard-skill', path: 'research/web-scrape' });
    expect(early.status).toBe(409);
    await report(asRunner);

    const pin = await actions().post({
      kind: 'pin-skill',
      path: 'research/web-scrape',
      pinned: true,
    });
    expect(pin.status).toBe(201);
    expect(pin.data).toMatchObject({
      kind: 'pin-skill',
      target: 'research/web-scrape',
      pinned: true,
      error: null,
    });
    const memory = await actions().post({
      kind: 'write-memory',
      file: 'MEMORY.md',
      content: 'Uses bun.\n§\nDeploys on Fridays.',
      baseSha256: sha256('Uses bun.'),
    });
    expect(memory.status).toBe(201);

    const policy = await asRunner['agent-runtime'].policy.get();
    expect(policy.data!.actions).toEqual([
      { id: pin.data!.id, kind: 'pin-skill', path: 'research/web-scrape', pinned: true },
      {
        id: memory.data!.id,
        kind: 'write-memory',
        file: 'MEMORY.md',
        content: 'Uses bun.\n§\nDeploys on Fridays.',
        baseSha256: sha256('Uses bun.'),
      },
    ]);

    await report(asRunner, {
      actions: [
        { id: pin.data!.id, error: null },
        { id: memory.data!.id, error: 'The memory changed since it was read' },
      ],
    });
    const listed = await actions().get();
    expect(listed.data).toEqual([
      expect.objectContaining({
        id: memory.data!.id,
        kind: 'write-memory',
        target: 'MEMORY.md',
        error: 'The memory changed since it was read',
      }),
    ]);
    // A failed action waits for the owner, not for the runner.
    const after = await asRunner['agent-runtime'].policy.get();
    expect(after.data!.actions).toEqual([]);
    expect(after.data!.revision).not.toBe(policy.data!.revision);

    // A newer decision on the same target replaces the failed one.
    const retry = await actions().post({
      kind: 'write-memory',
      file: 'MEMORY.md',
      content: '',
      baseSha256: sha256('Uses bun.'),
    });
    expect((await actions().get()).data).toEqual([
      expect.objectContaining({ id: retry.data!.id, error: null }),
    ]);

    // A discard replaces a pin that still waits.
    await actions().post({ kind: 'pin-skill', path: 'research/web-scrape', pinned: false });
    await actions().post({ kind: 'discard-skill', path: 'research/web-scrape' });
    expect((await actions().get()).data!.map(({ kind }) => kind)).toEqual([
      'write-memory',
      'discard-skill',
    ]);
  });

  it('refuses an action on a skill the agent did not create, or a malformed one', async () => {
    const { asOwner, asRunner, teamId, agentId } = await setup();
    await report(asRunner);
    const actions = () => agentRoute(asOwner, teamId, agentId)['runtime-actions'];

    expect(
      (await actions().post({ kind: 'discard-skill', path: 'productivity/airtable' })).status,
    ).toBe(404);
    expect((await actions().post({ kind: 'discard-skill', path: '' })).status).toBe(400);
    expect(
      (
        await actions().post({
          kind: 'write-memory',
          file: 'SOUL.md' as 'MEMORY.md',
          content: 'x',
          baseSha256: sha256(''),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await actions().post({
          kind: 'write-memory',
          file: 'USER.md',
          content: 'x'.repeat(16385),
          baseSha256: sha256(''),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await actions().post({
          kind: 'write-memory',
          file: 'USER.md',
          content: 'x',
          baseSha256: 'not-a-digest',
        })
      ).status,
    ).toBe(400);
  });

  it("takes a learned skill into the team's library and has the runner drop the agent's copy", async () => {
    const { asOwner, asRunner, teamId, agentId } = await setup();
    await report(asRunner);

    const res = await agentRoute(asOwner, teamId, agentId)['learned-skills'].promote.post({
      path: 'research/web-scrape',
    });
    expect(res.status).toBe(201);
    expect(res.data).toMatchObject({
      name: 'web-scrape',
      description: 'Scrape a site politely',
      source: 'inline',
      files: [expect.objectContaining({ path: 'references/sites.md' })],
    });

    const enabled = await agentRoute(asOwner, teamId, agentId).skills.get();
    expect(enabled.data!.map(({ id }) => id)).toEqual([res.data!.id]);
    const policy = await asRunner['agent-runtime'].policy.get();
    expect(policy.data!.skills).toEqual([
      expect.objectContaining({
        slug: `plan-${res.data!.id}`,
        markdown: webScrape.markdown,
        files: [{ path: 'references/sites.md', content: '# Sites' }],
      }),
    ]);
    expect(policy.data!.actions).toEqual([
      expect.objectContaining({ kind: 'discard-skill', path: 'research/web-scrape' }),
    ]);

    // The library already holds a skill of that name.
    const again = await agentRoute(asOwner, teamId, agentId)['learned-skills'].promote.post({
      path: 'research/web-scrape',
    });
    expect(again.status).toBe(409);
  });

  it('leaves a skill with the agent when the library cannot hold all of it', async () => {
    const { asOwner, asRunner, teamId, agentId } = await setup();
    const promote = () =>
      agentRoute(asOwner, teamId, agentId)['learned-skills'].promote.post({
        path: 'research/web-scrape',
      });

    await report(asRunner, {
      learnedSkills: [{ ...webScrape, markdown: '', files: [], truncated: true }],
    });
    expect((await promote()).status).toBe(409);
    // A script would be archived with the agent's copy.
    await report(asRunner, { learnedSkills: [{ ...webScrape, otherFiles: 1 }] });
    expect((await promote()).status).toBe(409);

    expect((await asOwner.teams({ teamId })['agent-skills'].get()).data!.items).toEqual([]);
    expect((await agentRoute(asOwner, teamId, agentId)['runtime-actions'].get()).data).toEqual([]);
  });

  it('lets a member act only with the rights to it', async () => {
    const { asOwner, asRunner, teamId, agentId } = await setup();
    await report(asRunner);
    const reader = await createRole(asOwner, 'MKT', {
      name: 'Agent reader',
      permissions: { ai_agents: { read: true } },
    });
    const asReader = await addProjectMember(asOwner, 'MKT', reader.data!.id);

    const content = await agentRoute(asReader, teamId, agentId)['learned-skills'].content.get({
      query: { path: 'research/web-scrape' },
    });
    expect(content.status).toBe(200);
    expect(
      (
        await agentRoute(asReader, teamId, agentId)['runtime-actions'].post({
          kind: 'discard-skill',
          path: 'research/web-scrape',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await agentRoute(asReader, teamId, agentId)['learned-skills'].promote.post({
          path: 'research/web-scrape',
        })
      ).status,
    ).toBe(403);

    // Someone outside the team does not see the agent at all.
    // Taking a skill over also enables it on the agent and discards the agent's copy.
    const skillManager = await createRole(asOwner, 'MKT', {
      name: 'Skill manager',
      permissions: {
        ai_agents: { read: true },
        agent_skills: { read: true, create: true, edit: true },
      },
    });
    const asSkillManager = await addProjectMember(asOwner, 'MKT', skillManager.data!.id);
    expect(
      (
        await agentRoute(asSkillManager, teamId, agentId)['learned-skills'].promote.post({
          path: 'research/web-scrape',
        })
      ).status,
    ).toBe(403);
    expect((await asOwner.teams({ teamId })['agent-skills'].get()).data!.items).toEqual([]);

    const outsider = authedApi((await signUpTestUser()).cookie);
    expect((await agentRoute(outsider, teamId, agentId)['runtime-actions'].get()).status).toBe(404);
  });

  // An agent does not decide on what it or another agent learned.
  it('exposes none of its routes as MCP tools', () => {
    expect(
      untaggedRoutes(
        (route) => route.includes('learned-skills') || route.includes('runtime-actions'),
      ),
    ).toEqual([
      'GET /teams/:teamId/ai-agents/:agentId/learned-skills/content',
      'POST /teams/:teamId/ai-agents/:agentId/learned-skills/promote',
      'GET /teams/:teamId/ai-agents/:agentId/runtime-actions',
      'POST /teams/:teamId/ai-agents/:agentId/runtime-actions',
    ]);
  });
});
