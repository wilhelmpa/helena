import { expect, test } from 'bun:test';
import { buildSystemPrompt, skillIndex, skillTrigger } from '../prompt';
import { skillTool } from '../tools/builtin';
import { SKILL_USAGE_CASES, usageSkills } from '../skill-usage-eval';

test('all role cases carry distinct skill steps and include negative controls', () => {
  expect(SKILL_USAGE_CASES.length).toBeGreaterThanOrEqual(40);
  expect(new Set(SKILL_USAGE_CASES.map((entry) => entry.id)).size).toBe(SKILL_USAGE_CASES.length);
  expect(new Set(SKILL_USAGE_CASES.map((entry) => entry.role)).size).toBe(8);
  expect(SKILL_USAGE_CASES.filter((entry) => !entry.skill).length).toBe(8);
});

test('skill index retains all skills and readable names with explicit triggers', () => {
  const skills = usageSkills().map((skill, index) => ({
    ...skill,
    displayName: skill.name,
    name: `plan-${index}`,
  }));
  const index = skillIndex(skills, 'coder', 'failing test');
  for (const skill of skills) {
    expect(index).toContain(skill.name);
    expect(index).toContain(skill.displayName);
  }
  expect(index).toContain('Wann verwenden:');
  expect(index.indexOf('systematic-debugging')).toBeLessThan(index.indexOf('seo-content'));
  expect(skillTrigger({ name: 'brainstorming', description: '', markdown: '' })).toContain(
    'Before designing',
  );
  const prompt = buildSystemPrompt({
    instructions: 'ROLE',
    runContext: 'PROJECT',
    skills,
    memory: null,
    workdir: '/tmp',
    serverInstructions: [],
    workspaceState: 'DIRTY',
  });
  for (const text of ['ROLE', 'PROJECT', 'DIRTY', 'vor jeder Handlung', 'Pflichtschritte'])
    expect(prompt).toContain(text);
});

test('full skill, reference and script source remain available and unknown files fail', async () => {
  const skill = {
    name: 'test',
    description: 'test',
    markdown: '# Complete\n' + 'body '.repeat(1000),
    files: [{ path: 'scripts/check.py', content: 'print("verified")' }],
  };
  const tool = skillTool([skill]);
  const ctx = { workdir: '/tmp', env: {}, signal: new AbortController().signal };
  const full = await tool.execute({ name: 'test' }, ctx);
  expect(full.text).toContain(skill.markdown);
  expect(full.text).toContain('scripts/check.py');
  expect((await tool.execute({ name: 'test', file: 'scripts/check.py' }, ctx)).text).toContain(
    'print("verified")',
  );
  expect((await tool.execute({ name: 'test', file: '../private' }, ctx)).isError).toBe(true);
});

test('large skill pages are explicit and can be loaded completely below the loop output limit', async () => {
  const lines = Array.from({ length: 60 }, (_, index) => `${index}: ${'body '.repeat(160)}`);
  const tool = skillTool([
    { name: 'large', description: 'large procedure', markdown: lines.join('\n') },
  ]);
  const ctx = { workdir: '/tmp', env: {}, signal: new AbortController().signal };
  const read: string[] = [];
  let offset = 0;
  for (;;) {
    const page = await tool.execute({ name: 'large', offset }, ctx);
    expect(page.isError).not.toBe(true);
    expect(page.text.length).toBeLessThan(12_000);
    const [body, marker] = page.text.split('\n(');
    read.push(...body!.split('\n'));
    const next = marker!.match(/^Next offset: (\d+)/);
    if (!next) {
      expect(marker).toBe('End of file)');
      break;
    }
    expect(Number(next[1])).toBeGreaterThan(offset);
    offset = Number(next[1]);
  }
  expect(read).toEqual(lines);
});
