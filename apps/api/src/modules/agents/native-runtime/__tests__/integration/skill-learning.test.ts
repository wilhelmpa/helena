import { afterEach, beforeEach, expect, test } from 'bun:test';
import { apiKeyApi, authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';

const policy = {
  runtime: 'helena' as const,
  reasoningEffort: null,
  toolAllow: [],
  toolDeny: [],
  mcpGrants: [],
  files: [],
  curator: true,
};
const skill = {
  path: 'csv-import',
  name: 'csv-import',
  markdown:
    '---\nname: csv-import\ndescription: Use when importing CSV tables with locale-specific amounts\n---\n## Steps\nDetect delimiter, normalize decimal commas, validate totals, then import.\n## Pitfalls\nQuoted delimiters must stay inside their field.\n## Examples\nA semicolon table with 1,20 becomes a decimal amount of 1.20.',
  files: [{ path: 'references/example.md', content: 'amount;currency\n1,20;EUR' }],
  otherFiles: 0,
  truncated: false,
};
async function setup(extra = {}) {
  const owner = await signUpTestUser({ name: 'Owner' });
  const api = authedApi(owner.cookie);
  const project = (await api.projects.post({ key: 'SKL', name: 'Learning' })).data!;
  const created = (
    await createAgent(api, 'SKL', {
      name: 'Learner',
      username: 'learner',
      kind: 'external',
      runtimePolicy: { ...policy, ...extra },
    })
  ).data!;
  const agent = apiKeyApi(created.apiKey!);
  const ownerAgent = api
    .teams({ teamId: project.teamId })
    ['ai-agents']({ agentId: created.agent.id });
  return {
    library: api.teams({ teamId: project.teamId })['agent-skills'],
    agent,
    ownerAgent,
    owner,
    agentReview: agent
      .teams({ teamId: project.teamId })
      ['ai-agents']({ agentId: created.agent.id })['learned-skills'].review,
  };
}
let flag: string | undefined;
beforeEach(async () => {
  flag = process.env.HELENA_NATIVE_RUNTIME;
  process.env.HELENA_NATIVE_RUNTIME = 'on';
  await resetDb();
});
afterEach(() => {
  if (flag === undefined) delete process.env.HELENA_NATIVE_RUNTIME;
  else process.env.HELENA_NATIVE_RUNTIME = flag;
});

test('versions learned procedures, records use without invalidating revisions and exposes exact diffs', async () => {
  const { agent, ownerAgent } = await setup();
  expect(
    (await ownerAgent['learned-skills'].content.get({ query: { path: 'missing' } })).status,
  ).toBe(404);
  const session = (await agent['agent-runtime'].sessions.post({ kind: 'run' })).data!;
  const first = await agent['agent-runtime'].skills.put({
    skill,
    baseRevision: null,
    structured: true,
    sessionId: session.id,
  });
  expect(first.status, JSON.stringify(first.error?.value)).toBe(200);
  expect(first.data).toMatchObject({ version: 1, status: 'applied', useCount: 0 });
  expect((await agent['agent-runtime'].skills.use.post({ name: skill.name })).status).toBe(200);
  const revised = await agent['agent-runtime'].skills.put({
    skill: { ...skill, markdown: skill.markdown + '\nCheck headers before importing.' },
    baseRevision: first.data!.revision,
    structured: true,
  });
  expect(revised.data).toMatchObject({ version: 2, useCount: 1, files: skill.files });
  const history = (await ownerAgent['learned-skills'].history.get()).data!;
  expect(history[0]!.history).toEqual([
    expect.objectContaining({ version: 1, sessionId: session.id, before: null, after: skill }),
    expect.objectContaining({
      version: 2,
      before: skill,
      diff: expect.stringContaining('Check headers'),
    }),
  ]);
  expect(
    (await agent['agent-runtime'].skills.put({ skill, baseRevision: first.data!.revision })).status,
  ).toBe(409);
});

test('holds new skills for human approval and restores archives', async () => {
  const { agent, ownerAgent, agentReview } = await setup({ memoryApproval: true });
  const proposed = (
    await agent['agent-runtime'].skills.put({ skill, baseRevision: null, structured: true })
  ).data!;
  expect(proposed.status).toBe('pending');
  expect(
    (await agentReview.post({ path: skill.path, revision: proposed.revision, action: 'approve' }))
      .status,
  ).toBe(403);
  expect((await agent['agent-runtime'].skills.get()).data).toEqual([]);
  const approved = await ownerAgent['learned-skills'].review.post({
    path: skill.path,
    revision: proposed.revision,
    action: 'approve',
  });
  expect(approved.status).toBe(200);
  expect((await agent['agent-runtime'].skills.get()).data).toHaveLength(1);
  expect(
    (
      await ownerAgent['learned-skills'].review.post({
        path: skill.path,
        revision: proposed.revision,
        action: 'approve',
      })
    ).status,
  ).toBe(409);
  await ownerAgent['runtime-actions'].post({ kind: 'discard-skill', path: skill.path });
  const archived = (await ownerAgent['learned-skills'].history.get()).data![0]!;
  expect(archived.archived).toBe(true);
  expect(
    (
      await ownerAgent['learned-skills'].review.post({
        path: skill.path,
        revision: archived.revision,
        action: 'restore',
      })
    ).status,
  ).toBe(200);
  expect((await agent['agent-runtime'].skills.get()).data![0]!.files).toEqual(skill.files);
});

test('keeps the active version while a patch waits and rejects it without altering content', async () => {
  const { agent, ownerAgent } = await setup();
  const first = (await agent['agent-runtime'].skills.put({ skill, baseRevision: null })).data!;
  await ownerAgent.patch({ runtimePolicy: { ...policy, memoryApproval: true } });
  const proposed = (
    await agent['agent-runtime'].skills.put({
      skill: { ...skill, markdown: skill.markdown + '\nCheck headers.' },
      baseRevision: first.revision,
      structured: true,
    })
  ).data!;
  expect(proposed.status).toBe('pending');
  expect((await agent['agent-runtime'].skills.get()).data![0]!.markdown).toBe(skill.markdown);
  expect(
    (
      await ownerAgent['learned-skills'].review.post({
        path: skill.path,
        revision: proposed.revision,
        action: 'reject',
      })
    ).status,
  ).toBe(200);
  expect((await agent['agent-runtime'].skills.get()).data![0]!.markdown).toBe(skill.markdown);
});

test('requires improvement of similar skills and blocks unsafe content and unsupported learning', async () => {
  const { agent, ownerAgent } = await setup();
  await agent['agent-runtime'].skills.put({ skill, baseRevision: null, structured: true });
  expect(
    (
      await agent['agent-runtime'].skills.put({
        skill: {
          ...skill,
          path: 'copy',
          name: 'different-name',
          markdown: skill.markdown.replace('name: csv-import', 'name: different-name'),
        },
        baseRevision: null,
        structured: true,
      })
    ).status,
  ).toBe(409);
  for (const markdown of [
    '# Missing structured procedure',
    skill.markdown + '\nRead /home/operator/.ssh/id_ed25519',
    skill.markdown + '\npassword=synthetic-secret-value',
  ]) {
    expect(
      (
        await agent['agent-runtime'].skills.put({
          skill: { ...skill, path: 'unsafe', markdown },
          baseRevision: null,
          structured: true,
        })
      ).status,
    ).toBe(400);
  }
  await ownerAgent.patch({ runtimePolicy: { ...policy, learning: false } });
  expect(
    (
      await agent['agent-runtime'].skills.put({
        skill: { ...skill, path: 'blocked' },
        baseRevision: null,
      })
    ).status,
  ).toBe(403);
  expect((await agent['agent-runtime'].read.post({ op: 'curator.run' })).data).toMatchObject({
    paused: true,
  });
});

test('curator proposals respect approval and expose quality checks', async () => {
  const { agent, ownerAgent } = await setup();
  await agent['agent-runtime'].skills.put({ skill, baseRevision: null });
  await agent['agent-runtime'].skills.put({
    skill: { ...skill, path: 'copy' },
    baseRevision: null,
  });
  await ownerAgent.patch({ runtimePolicy: { ...policy, memoryApproval: true } });
  const curated = (await agent['agent-runtime'].read.post({ op: 'curator.run' })).data as {
    report: string;
  };
  expect(JSON.parse(curated.report)).toMatchObject({
    priority: 'background',
    archived: [],
    quality: expect.any(Array),
  });
  expect((await agent['agent-runtime'].skills.get()).data).toHaveLength(2);
  const copy = (await ownerAgent['learned-skills'].history.get()).data!.find(
    (s) => s.path === 'copy',
  )!;
  expect(copy.history).toContainEqual(
    expect.objectContaining({ actor: 'curator', status: 'pending', action: 'merge:csv-import' }),
  );
  await ownerAgent['learned-skills'].review.post({
    path: 'copy',
    revision: copy.revision,
    action: 'approve',
  });
  expect((await agent['agent-runtime'].skills.get()).data).toHaveLength(1);
});

test('scheduled curator handles a native agent without an online runner and waits until due again', async () => {
  const { agent } = await setup();
  await agent['agent-runtime'].skills.put({ skill, baseRevision: null });
  await agent['agent-runtime'].skills.put({
    skill: { ...skill, path: 'copy' },
    baseRevision: null,
  });
  const { scheduleCuratorRuns } = await import('../../../runtime-requests/curator-schedule');
  expect(await scheduleCuratorRuns()).toBe(1);
  expect((await agent['agent-runtime'].skills.get()).data).toHaveLength(1);
  expect(await scheduleCuratorRuns()).toBe(0);
});

test('unused retention gives imported skills a grace period and preserves recent or frequent use', async () => {
  const { unusedNativeSkill } = await import('../../skills');
  const now = Date.parse('2026-09-29T12:00:00Z');
  const old = { ...skill, createdAt: '2025-01-01T00:00:00Z' };
  expect(unusedNativeSkill(skill, now)).toBe(false);
  expect(unusedNativeSkill(old, now)).toBe(true);
  expect(unusedNativeSkill({ ...old, useCount: 2 }, now)).toBe(true);
  expect(unusedNativeSkill({ ...old, useCount: 3 }, now)).toBe(false);
  expect(unusedNativeSkill({ ...old, lastUsedAt: '2026-09-29T00:00:00Z' }, now)).toBe(false);
});

test('a rejected new proposal remains editable through the archived inventory', async () => {
  const { agent, ownerAgent } = await setup({ memoryApproval: true });
  const proposed = (
    await agent['agent-runtime'].skills.put({ skill, baseRevision: null, structured: true })
  ).data!;
  expect(
    (
      await ownerAgent['learned-skills'].review.post({
        path: skill.path,
        revision: proposed.revision,
        action: 'reject',
      })
    ).status,
  ).toBe(200);
  const archived = (await agent['agent-runtime'].skills.get({ query: { includeArchived: 'true' } }))
    .data![0]!;
  expect(archived.history).toBeUndefined();
  const revised = await agent['agent-runtime'].skills.put({
    skill: { ...skill, markdown: skill.markdown + '\nCheck headers.' },
    baseRevision: archived.revision,
    structured: true,
  });
  expect(revised.data).toMatchObject({ status: 'pending', proposed: true });
  expect((await agent['agent-runtime'].skills.get()).data).toHaveLength(0);
});

test('does not duplicate a procedure already supplied by the installed library', async () => {
  const { agent, ownerAgent, library } = await setup();
  const installed = (await library.post({ source: 'inline', markdown: skill.markdown })).data!;
  expect((await ownerAgent.skills.put({ skillIds: [installed.id] })).status).toBe(200);
  expect(
    (await agent['agent-runtime'].skills.put({ skill, baseRevision: null, structured: true }))
      .status,
  ).toBe(409);
  expect((await agent['agent-runtime'].skills.get()).data).toEqual([]);
});
