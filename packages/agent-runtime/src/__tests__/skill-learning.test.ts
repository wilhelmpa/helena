import { expect, test } from 'bun:test';
import { runAgent, shouldReflect } from '../agent';
import { MemorySink } from '../events';
import type { HelenaApi, LearnedRuntimeSkill } from '../helena-client';
import { MemorySessionStore } from '../session';
import { learnSkillTool } from '../tools/builtin';
import { factoryOf, scriptedModel, type Turn } from './fake-model';

const skill: LearnedRuntimeSkill = {
  path: 'csv-import',
  name: 'csv-import',
  files: [],
  otherFiles: 0,
  truncated: false,
  markdown:
    '---\nname: csv-import\ndescription: Import CSV with decimal commas\n---\n## Steps\nNormalize commas and validate totals.\n## Pitfalls\nPreserve quoted delimiters.\n## Examples\n1,20 becomes 1.20.',
};
function fixture() {
  const skills: LearnedRuntimeSkill[] = [];
  const uses: string[] = [];
  const api: HelenaApi = {
    decide: async () => ({ allowed: true, message: '' }),
    createSession: async () => 'unused',
    loadSession: async () => null,
    appendItems: async () => {},
    compact: async () => {},
    memory: async () => ({ files: [], notes: [], approval: false }),
    note: async () => {},
    proposeMemory: async () => ({ status: 'applied' }),
    searchSessions: async () => [],
    learnedSkills: async () => skills,
    saveSkill: async (value) => {
      const saved = { ...value, revision: 'r1', status: 'applied' };
      skills.splice(0, skills.length, saved);
      return saved;
    },
    skillUsed: async (name) => {
      uses.push(name);
    },
  };
  async function run(turns: Turn[], enabled = true) {
    const sink = new MemorySink();
    const model = scriptedModel(turns);
    const result = await runAgent({
      config: {
        model: 'test/model',
        servers: [
          { provider: 'test', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1' },
        ],
        workdir: '/tmp',
        memory: { enabled },
        policy: 'allow',
        tools: { core: ['inspect', 'normalize', 'verify'] },
      },
      prompt: 'Import this monthly CSV and validate totals.',
      sink,
      sessions: new MemorySessionStore(),
      helena: api,
      env: {},
      signal: new AbortController().signal,
      modelFactory: factoryOf({ 'test/model': model }),
      extraTools: ['inspect', 'normalize', 'verify'].map((name) => ({
        name,
        description: name,
        inputSchema: { type: 'object', properties: {} },
        readOnly: true,
        execute: async () => ({ text: 'Verified decimal comma conversion, totals correct.' }),
      })),
    });
    return { result, sink, model };
  }
  return { api, skills, uses, run };
}
const work: Turn[] = ['inspect', 'normalize', 'verify'].map((name) => ({
  calls: [{ name, input: {} }],
}));
const creation: Turn = {
  calls: [{ name: 'skill_manage', input: { action: 'create', ...skill, baseRevision: null } }],
};

test('native reflection saves a skill and the next run uses it with fewer task calls', async () => {
  const f = fixture();
  const first = await f.run([
    ...work,
    { text: 'Imported successfully.' },
    creation,
    { text: 'Saved.' },
  ]);
  expect(f.skills).toHaveLength(1);
  expect(first.sink.of('tool-call')).toContainEqual(
    expect.objectContaining({ name: 'skill_manage', id: expect.stringContaining('reflection:') }),
  );
  expect(first.sink.text()).not.toContain('Saved.');
  const next = await f.run([
    { calls: [{ name: 'load_skill', input: { name: skill.name } }] },
    { calls: [{ name: 'verify', input: {} }] },
    { text: 'Imported successfully.' },
  ]);
  expect(f.uses).toEqual([skill.name]);
  expect(next.result.spend.toolCalls).toBeLessThan(3);
  expect(next.model.doStreamCalls[0]!.prompt).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ role: 'system', content: expect.stringContaining(skill.name) }),
    ]),
  );
});

test('a double JSON encoded skill create preserves markdown and its quoted content', async () => {
  const f = fixture();
  const markdown = `${skill.markdown}\nQuoted example: "abc"; umlaut: ä.\n`;
  const { sink } = await f.run([
    {
      calls: [
        {
          name: 'skill_manage',
          input: JSON.stringify(
            JSON.stringify({ action: 'create', ...skill, markdown, baseRevision: null }),
          ),
        },
      ],
    },
    { text: 'Done.' },
  ]);
  expect(f.skills).toHaveLength(1);
  expect(f.skills[0]!.markdown).toBe(markdown);
  expect(sink.of('tool-result')[0]!.isError).not.toBe(true);
});

test('disabled learning and trivial tasks never enter reflection', async () => {
  const f = fixture();
  const disabled = await f.run([...work, { text: 'Done.' }, creation], false);
  expect(disabled.model.doStreamCalls).toHaveLength(4);
  await f.run([{ text: 'Four.' }, creation]);
  expect(f.skills).toEqual([]);
});

test('patch needs a current revision and exactly one match, preserving reference files', async () => {
  const f = fixture();
  f.skills.push({ ...skill, files: [{ path: 'example.md', content: 'sample' }], revision: 'r1' });
  const tool = learnSkillTool(f.api);
  const context = {} as Parameters<typeof tool.execute>[1];
  expect(
    await tool.execute(
      {
        action: 'patch',
        path: skill.path,
        baseRevision: 'stale',
        oldText: 'commas',
        newText: 'decimal commas',
      },
      context,
    ),
  ).toMatchObject({ isError: true });
  expect(
    await tool.execute(
      {
        action: 'patch',
        path: skill.path,
        baseRevision: 'r1',
        oldText: 'missing',
        newText: 'value',
      },
      context,
    ),
  ).toMatchObject({ isError: true });
  await tool.execute(
    {
      action: 'patch',
      path: `skills/${skill.path}/SKILL.md`,
      baseRevision: 'r1',
      oldText: 'Normalize commas',
      newText: 'Normalize decimal commas',
    },
    context,
  );
  expect(f.skills[0]!.markdown).toContain('Normalize decimal commas');
  expect(f.skills[0]!.files).toEqual([{ path: 'example.md', content: 'sample' }]);
  const failureTool = learnSkillTool(f.api, { allowCreate: () => false });
  expect(await failureTool.execute({ action: 'create', ...skill }, context)).toMatchObject({
    isError: true,
  });
});

test('a failed loaded skill can be reflected on but a failed task cannot create a procedure', () => {
  const result = {
    status: 'failed',
    spend: { toolCalls: 2 },
    toolsUsed: ['load_skill'],
    testsGreen: false,
  } as Parameters<typeof shouldReflect>[1];
  expect(shouldReflect({} as never, result)).toBe(true);
  expect(shouldReflect({} as never, { ...result, toolsUsed: ['shell'] })).toBe(false);
  expect(shouldReflect({ memory: { enabled: false } } as never, result)).toBe(false);
});

test('skill management bounds a learned frontmatter description before saving', async () => {
  const f = fixture();
  const tool = learnSkillTool(f.api);
  await tool.execute(
    {
      action: 'create',
      ...skill,
      markdown: skill.markdown.replace('Import CSV with decimal commas', 'x'.repeat(389)),
      baseRevision: null,
    },
    {} as Parameters<typeof tool.execute>[1],
  );
  expect(f.skills[0]?.markdown).toContain('description: "' + 'x'.repeat(299) + '…"');
});
