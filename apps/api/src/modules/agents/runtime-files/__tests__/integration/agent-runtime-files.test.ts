import { beforeEach, describe, expect, it } from 'bun:test';

import { apiKeyApi, authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { addProjectMember } from '#tests/helpers/members';
import { createRole } from '#tests/helpers/roles';
import { untaggedRoutes } from '#tests/helpers/mcp';

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  const project = await asOwner.projects.post({ key: 'HOME', name: 'Home' });
  const created = await createAgent(asOwner, 'HOME', {
    name: 'Hermes',
    username: 'hermes',
    kind: 'external',
    runtimePolicy: {
      reasoningEffort: 'high',
      toolAllow: ['browser'],
      toolDeny: ['message.send'],
      mcpGrants: ['itsaplan__get_issue'],
      files: [],
    },
  });
  return {
    asOwner,
    asRunner: apiKeyApi(created.data!.apiKey!),
    teamId: project.data!.teamId,
    agentId: created.data!.agent.id,
  };
}

const runtimeFiles = (api: Api, teamId: number, agentId: number) =>
  api.teams({ teamId })['ai-agents']({ agentId })['runtime-files'];

describe('agent runtime files', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('exposes every runtime file route to MCP', () => {
    expect(untaggedRoutes((route) => route.includes('/runtime-files'))).toEqual([]);
  });

  it('upserts, lists, and deletes managed Markdown without replacing other policy', async () => {
    const { asOwner, asRunner, teamId, agentId } = await setup();
    const files = runtimeFiles(asOwner, teamId, agentId);

    expect((await files.get()).data).toEqual([]);
    const first = await files.put({ path: 'AGENTS.md', content: '# Instructions' });
    expect(first.status).toBe(200);
    expect(first.data).toEqual([
      { path: 'AGENTS.md', kind: 'instructions', content: '# Instructions' },
    ]);
    await files.put({ path: 'MEMORY.md', content: '# Memory' });
    const updated = await files.put({ path: 'AGENTS.md', content: '# Updated' });
    expect(updated.data).toEqual([
      { path: 'AGENTS.md', kind: 'instructions', content: '# Updated' },
      { path: 'MEMORY.md', kind: 'memory', content: '# Memory' },
    ]);

    const policy = await asRunner['agent-runtime'].policy.get();
    expect(policy.data?.runtimePolicy).toMatchObject({
      reasoningEffort: 'high',
      toolAllow: ['browser'],
      toolDeny: ['message.send'],
      mcpGrants: ['itsaplan__get_issue'],
      files: updated.data,
    });
    expect(JSON.stringify(policy.data)).not.toContain('apiKey');
    expect(JSON.stringify(policy.data)).not.toContain('credential');

    expect((await files.delete({}, { query: { path: 'MEMORY.md' } })).status).toBe(204);
    expect((await files.get()).data).toEqual([
      { path: 'AGENTS.md', kind: 'instructions', content: '# Updated' },
    ]);
  });

  it('rejects traversal, non-Markdown files, and instruction-memory mismatches', async () => {
    const { asOwner, teamId, agentId } = await setup();
    const files = runtimeFiles(asOwner, teamId, agentId);

    expect((await files.put({ path: '../config.yaml', content: 'secret: no' })).status).toBe(400);
    expect((await files.put({ path: 'memory/token.json', content: '{}' })).status).toBe(400);

    const patched = await asOwner
      .teams({ teamId })
      ['ai-agents']({ agentId })
      .patch({
        runtimePolicy: {
          reasoningEffort: null,
          toolAllow: [],
          toolDeny: [],
          mcpGrants: [],
          files: [{ kind: 'memory', path: 'AGENTS.md', content: '# Wrong kind' }],
        },
      });
    expect(patched.status).toBe(400);
    expect((await files.get()).data).toEqual([]);
  });

  it('requires an external agent', async () => {
    const { asOwner, teamId } = await setup();
    const internal = await createAgent(asOwner, 'HOME', {
      name: 'Internal',
      username: 'internal',
      kind: 'internal',
    });
    const files = runtimeFiles(asOwner, teamId, internal.data!.agent.id);
    expect((await files.get()).status).toBe(400);
    expect((await files.put({ path: 'SOUL.md', content: '# Soul' })).status).toBe(400);
  });

  it('keeps project-limited members away from agents they cannot see', async () => {
    const { asOwner, teamId, agentId } = await setup();
    await asOwner.teams({ teamId }).projects.post({ key: 'OPS', name: 'Operations' });
    const ops = await createAgent(asOwner, 'OPS', {
      name: 'Ops Hermes',
      username: 'ops-hermes',
      kind: 'external',
    });
    const role = await createRole(asOwner, 'HOME', {
      name: 'Agent editor',
      permissions: { ai_agents: { read: true, edit: true } },
    });
    const asMember = await addProjectMember(asOwner, 'HOME', role.data!.id);

    expect((await runtimeFiles(asMember, teamId, agentId).get()).status).toBe(200);
    const hidden = runtimeFiles(asMember, teamId, ops.data!.agent.id);
    expect((await hidden.get()).status).toBe(404);
    expect((await hidden.put({ path: 'AGENTS.md', content: '# Hidden' })).status).toBe(404);
  });
});
