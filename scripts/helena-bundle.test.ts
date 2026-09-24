import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { parseBundleJson, validateBundle, type TemplateBundle } from './helena-bundle.ts';
import { readBundleDir, writeBundleDir } from './helena-bundle-files.ts';
import { checkBundle } from '../packages/sdk/src/server/bundle-schema.ts';

const BUNDLES = join(import.meta.dir, '..', 'bundles');
const bundleDirs = readdirSync(BUNDLES).map((name) => join(BUNDLES, name));

describe.each(bundleDirs)('bundle %s', (dir) => {
  const bundle = readBundleDir(dir);

  test('is valid', () => {
    expect(validateBundle(bundle)).toEqual([]);
    // The published JSON Schema's shape holds too (@helena/sdk/bundle.schema.json).
    expect(checkBundle(JSON.parse(JSON.stringify(bundle)))).toEqual(bundle);
  });

  test('reads back the same after writing it out', () => {
    const out = mkdtempSync(join(tmpdir(), 'helena-bundle-'));
    try {
      writeBundleDir(bundle, out);
      expect(readBundleDir(out)).toEqual(bundle);
      expect(parseBundleJson(JSON.stringify(bundle))).toEqual(bundle);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  // What a person sees: the product is only called Helena.
  test('names no other product', () => {
    const visible = [
      bundle.displayName,
      bundle.description,
      ...bundle.agents.flatMap((a) => [
        a.description,
        a.instructions,
        a.helena.displayName,
        a.helena.roleTitle,
      ]),
      ...bundle.skills.flatMap((s) =>
        s.source.type === 'files' ? Object.values(s.source.files) : [],
      ),
    ].join('\n');
    expect(visible).not.toMatch(/Volition/);
    expect(visible).not.toMatch(/It[’']s a Plan/);
  });

  test('every reference a file skill carries is linked from its SKILL.md', () => {
    for (const skill of bundle.skills) {
      if (skill.source.type !== 'files') continue;
      for (const path of Object.keys(skill.source.files)) {
        if (path !== 'SKILL.md') expect(skill.source.files['SKILL.md']).toContain(path);
      }
    }
  });
});

describe('validateBundle', () => {
  const base = (): TemplateBundle => ({
    format: 'helena.template-bundle',
    formatVersion: 1,
    name: 'example',
    displayName: 'Beispiel',
    version: '1.0.0',
    description: 'Ein Beispiel.',
    license: 'MIT',
    author: { name: 'Beispiel' },
    skills: [
      {
        name: 'one',
        source: {
          type: 'files',
          files: { 'SKILL.md': '---\nname: one\ndescription: x\n---\nBody' },
        },
        license: 'MIT',
        attribution: 'Beispiel',
      },
    ],
    mcpServers: { docs: { type: 'http', url: 'https://example.com/mcp' } },
    agents: [
      {
        name: 'helper',
        description: 'Hilft.',
        instructions: 'Du hilfst.',
        model: null,
        effort: null,
        maxTurns: null,
        disallowedTools: [],
        skills: ['one'],
        mcpServers: ['docs'],
        helena: {
          displayName: 'Helfer',
          roleTitle: 'Helfer',
          capabilities: ['help'],
          runBudgetSeconds: null,
          triggers: { mention: true, assign: true },
        },
      },
    ],
  });

  test('accepts a minimal bundle', () => {
    expect(validateBundle(base())).toEqual([]);
  });

  test('refuses an unpinned GitHub skill, a foreign license and a missing skill', () => {
    const bundle = base();
    bundle.skills.push({
      name: 'two',
      source: { type: 'github', url: 'https://github.com/a/b/tree/main/skills/two' },
      license: 'SSPL-1.0',
      attribution: 'a/b',
    });
    bundle.agents[0]!.skills.push('three');
    expect(validateBundle(bundle)).toEqual([
      'skill two: license SSPL-1.0',
      'skill two: GitHub source is not pinned to a commit',
      'agent helper: skill three is not in the bundle',
    ]);
  });

  test('refuses credentials in an MCP server and a capability two agents share', () => {
    const bundle = base();
    Object.assign(bundle.mcpServers.docs!, { headers: { Authorization: 'x' } });
    bundle.agents.push({ ...bundle.agents[0]!, name: 'helper-2' });
    expect(validateBundle(bundle)).toEqual([
      'MCP server docs: env and headers are not allowed in a bundle',
      'agent helper-2: capability help is also on helper',
    ]);
  });
});
