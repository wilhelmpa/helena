import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import catalog from '../../../../scripts/tool-regression/catalog.json';
import type { HelenaApi } from '../helena-client';
import {
  clarifyTool,
  sumIntegersTool,
  findToolsTool,
  skillTool,
  learnSkillTool,
  memoryTool,
  sessionSearchTool,
} from '../tools/builtin';
import { FILE_TOOLS } from '../tools/files';
import { shellTool } from '../tools/shell';
import { executeTool } from '../tools/types';

const api = {
  memory: async () => ({ files: [], notes: [], approval: false }),
  searchSessions: async () => [],
  learnedSkills: async () => [],
  saveSkill: async () => {
    throw new Error('Unexpected fixture mutation');
  },
} as unknown as HelenaApi;
const tools = [
  clarifyTool,
  sumIntegersTool,
  findToolsTool(() => [{ name: 'ABSCHLUSSTEST', description: 'ABSCHLUSSTEST fixture' }]),
  skillTool([{ name: 'ABSCHLUSSTEST', description: 'ABSCHLUSSTEST', markdown: '# ABSCHLUSSTEST' }]),
  learnSkillTool(api),
  memoryTool(api),
  sessionSearchTool(api),
  ...FILE_TOOLS,
  shellTool({ timeoutMs: 1000 }),
];
const inputs: Record<string, Record<string, unknown>> = {
  clarify: { question: 'ABSCHLUSSTEST?' },
  sum_integers: { values: [1, 2] },
  find_tools: { query: 'ABSCHLUSSTEST' },
  load_skill: { name: 'ABSCHLUSSTEST' },
  skill_manage: { action: 'list' },
  memory: { action: 'read' },
  search_sessions: { query: 'ABSCHLUSSTEST' },
  read_file: { path: 'ABSCHLUSSTEST.txt' },
  write_file: { path: 'ABSCHLUSSTEST.txt', content: 'ABSCHLUSSTEST' },
  edit_file: {
    path: 'ABSCHLUSSTEST.txt',
    old_text: 'ABSCHLUSSTEST',
    new_text: 'ABSCHLUSSTEST edited',
  },
  list_files: {},
  search_files: { pattern: 'ABSCHLUSSTEST' },
  shell: { command: 'printf ABSCHLUSSTEST' },
};
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

test('every native registration has an explicit executable fixture', () => {
  expect(tools.map((tool) => tool.name).sort()).toEqual(catalog.runtime);
  expect(Object.keys(inputs).sort()).toEqual(catalog.runtime);
});

for (const tool of tools) {
  test(`${tool.name}: real runtime execution and invalid arguments`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'volition-ABSCHLUSSTEST-'));
    directories.push(root);
    const workdir = join(root, 'project');
    const other = join(root, 'FOREIGN');
    await Promise.all([mkdir(workdir), mkdir(other)]);
    await writeFile(join(workdir, 'ABSCHLUSSTEST.txt'), 'ABSCHLUSSTEST');
    await writeFile(join(other, 'ABSCHLUSSTEST.txt'), 'ABSCHLUSSTEST');
    const context = { workdir, env: {}, signal: new AbortController().signal };
    const result = await executeTool(tool, inputs[tool.name]!, context);
    expect(result.isError).not.toBe(true);
    expect(typeof result.text).toBe('string');
    const key = tool.inputSchema.required?.[0] ?? Object.keys(tool.inputSchema.properties)[0]!;
    const bad = await executeTool(tool, { ...inputs[tool.name], [key]: [] }, context);
    expect(bad).toMatchObject({ isError: true, text: expect.stringContaining(key) });
    if (FILE_TOOLS.includes(tool)) {
      const foreign = await executeTool(
        tool,
        {
          ...inputs[tool.name],
          path: ['list_files', 'search_files'].includes(tool.name)
            ? '../FOREIGN'
            : '../FOREIGN/ABSCHLUSSTEST.txt',
        },
        context,
      );
      expect(foreign.isError).toBe(true);
      expect(foreign.text).toContain('outside');
    }
  });
}

test('shell exit 7 remains a neutral nonzero result', async () => {
  const workdir = await mkdtemp(join(tmpdir(), 'volition-ABSCHLUSSTEST-'));
  directories.push(workdir);
  const result = await executeTool(
    tools.find((tool) => tool.name === 'shell')!,
    { command: 'printf ABSCHLUSSTEST; exit 7' },
    { workdir, env: {}, signal: new AbortController().signal },
  );
  expect(result).toMatchObject({ exitCode: 7, outcome: 'nonzero_with_output' });
  expect(result.isError).not.toBe(true);
});
