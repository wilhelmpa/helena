// The directory form of a Helena template bundle (format: helena-bundle.ts):
//
//   helena.bundle.json         name, displayName, version, description, license,
//                              author, and the skills that come from GitHub
//   agents/<name>.md           one agent template: YAML frontmatter + instructions
//   skills/<name>/SKILL.md     a skill carried as files, with refs/<file>.md
//   .mcp.json                  { "mcpServers": { "<name>": { … } } }
//
// Bun only (file system, Bun.YAML): the entry `@helena/sdk/bundles`, apart from
// `@helena/sdk/server`, which also runs on Node (the runner). The browser gets the
// one-document JSON form.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  BUNDLE_FORMAT,
  BUNDLE_FORMAT_VERSION,
  BUNDLE_MANIFEST,
  type BundleAgent,
  type BundleMcpServer,
  type BundleSkill,
  type TemplateBundle,
} from '../templates';

interface Manifest {
  format: typeof BUNDLE_FORMAT;
  formatVersion: typeof BUNDLE_FORMAT_VERSION;
  name: string;
  displayName: string;
  version: string;
  description: string;
  license: string;
  author: { name: string; url?: string };
  skills: { name: string; github: string; license: string; attribution: string }[];
}

const MCP_FILE = '.mcp.json';
const FRONTMATTER = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function listDir(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => String(v)) : [];
}

function orNull<T extends string | number>(value: unknown, kind: 'string' | 'number'): T | null {
  return typeof value === kind ? (value as T) : null;
}

function readAgent(path: string): BundleAgent {
  const text = readFileSync(path, 'utf8');
  const match = FRONTMATTER.exec(text);
  if (!match) throw new Error(`${path}: no YAML frontmatter`);
  const meta = (Bun.YAML.parse(match[1]!) ?? {}) as Record<string, unknown>;
  const helena = (meta.helena ?? {}) as Record<string, unknown>;
  const triggers = (helena.triggers ?? {}) as Record<string, unknown>;
  return {
    name: String(meta.name ?? ''),
    description: String(meta.description ?? ''),
    instructions: match[2]!.trim(),
    model: orNull<string>(meta.model, 'string'),
    effort: orNull<string>(meta.effort, 'string'),
    maxTurns: orNull<number>(meta.maxTurns, 'number'),
    disallowedTools: strings(meta.disallowedTools),
    skills: strings(meta.skills),
    mcpServers: strings(meta.mcpServers),
    helena: {
      displayName: String(helena.displayName ?? ''),
      roleTitle: String(helena.roleTitle ?? ''),
      capabilities: strings(helena.capabilities),
      runBudgetSeconds: orNull<number>(helena.runBudgetSeconds, 'number'),
      triggers: { mention: triggers.mention !== false, assign: triggers.assign !== false },
    },
  };
}

function readFileSkill(dir: string, name: string, manifest: Manifest): BundleSkill {
  const files: Record<string, string> = { 'SKILL.md': readFileSync(join(dir, 'SKILL.md'), 'utf8') };
  for (const file of listDir(join(dir, 'refs'))) {
    if (file.endsWith('.md')) files[`refs/${file}`] = readFileSync(join(dir, 'refs', file), 'utf8');
  }
  return {
    name,
    source: { type: 'files', files },
    license: manifest.license,
    attribution: `${manifest.author.name} (${manifest.license})`,
  };
}

// Reads a bundle directory. Agents and file skills come in file-name order, after the
// GitHub skills of the manifest.
export function readBundleDir(dir: string): TemplateBundle {
  const manifest = JSON.parse(readFileSync(join(dir, BUNDLE_MANIFEST), 'utf8')) as Manifest;
  const skills: BundleSkill[] = manifest.skills.map((skill) => ({
    name: skill.name,
    source: { type: 'github', url: skill.github },
    license: skill.license,
    attribution: skill.attribution,
  }));
  for (const name of listDir(join(dir, 'skills'))) {
    const skillDir = join(dir, 'skills', name);
    if (statSync(skillDir).isDirectory()) skills.push(readFileSkill(skillDir, name, manifest));
  }
  const mcpPath = join(dir, MCP_FILE);
  const mcpServers = existsSync(mcpPath)
    ? ((
        JSON.parse(readFileSync(mcpPath, 'utf8')) as {
          mcpServers?: Record<string, BundleMcpServer>;
        }
      ).mcpServers ?? {})
    : {};
  const agents = listDir(join(dir, 'agents'))
    .filter((file) => file.endsWith('.md'))
    .map((file) => readAgent(join(dir, 'agents', file)));
  return {
    format: manifest.format,
    formatVersion: manifest.formatVersion,
    name: manifest.name,
    displayName: manifest.displayName,
    version: manifest.version,
    description: manifest.description,
    license: manifest.license,
    author: manifest.author,
    skills,
    mcpServers,
    agents,
  };
}

// A YAML scalar: plain when it reads back as the same string, JSON-quoted otherwise.
function scalar(value: string | number | boolean | null): string {
  if (value === null) return 'null';
  if (typeof value !== 'string') return String(value);
  const plain =
    /^[A-Za-zÀ-ž][A-Za-zÀ-ž0-9 ._/&()-]*$/.test(value) &&
    !/^(true|false|null|yes|no|on|off)$/i.test(value) &&
    !/ $/.test(value);
  return plain ? value : JSON.stringify(value);
}

function list(items: string[], indent: string): string {
  return items.length === 0
    ? ' []'
    : `\n${items.map((item) => `${indent}- ${scalar(item)}`).join('\n')}`;
}

export function agentMarkdown(agent: BundleAgent): string {
  const h = agent.helena;
  return [
    '---',
    `name: ${scalar(agent.name)}`,
    `description: ${scalar(agent.description)}`,
    `model: ${scalar(agent.model)}`,
    `effort: ${scalar(agent.effort)}`,
    `maxTurns: ${scalar(agent.maxTurns)}`,
    `disallowedTools:${list(agent.disallowedTools, '  ')}`,
    `skills:${list(agent.skills, '  ')}`,
    `mcpServers:${list(agent.mcpServers, '  ')}`,
    'helena:',
    `  displayName: ${scalar(h.displayName)}`,
    `  roleTitle: ${scalar(h.roleTitle)}`,
    `  capabilities:${list(h.capabilities, '    ')}`,
    `  runBudgetSeconds: ${scalar(h.runBudgetSeconds)}`,
    `  triggers: { mention: ${h.triggers.mention}, assign: ${h.triggers.assign} }`,
    '---',
    '',
    agent.instructions.trim(),
    '',
  ].join('\n');
}

// Writes a bundle as a directory. File skills must carry the bundle's own license.
export function writeBundleDir(bundle: TemplateBundle, dir: string): void {
  mkdirSync(join(dir, 'agents'), { recursive: true });
  const manifest: Manifest = {
    format: bundle.format,
    formatVersion: bundle.formatVersion,
    name: bundle.name,
    displayName: bundle.displayName,
    version: bundle.version,
    description: bundle.description,
    license: bundle.license,
    author: bundle.author,
    skills: bundle.skills.flatMap((skill) =>
      skill.source.type === 'github'
        ? [
            {
              name: skill.name,
              github: skill.source.url,
              license: skill.license,
              attribution: skill.attribution,
            },
          ]
        : [],
    ),
  };
  writeFileSync(join(dir, BUNDLE_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  if (Object.keys(bundle.mcpServers).length > 0) {
    writeFileSync(
      join(dir, MCP_FILE),
      `${JSON.stringify({ mcpServers: bundle.mcpServers }, null, 2)}\n`,
    );
  }
  for (const skill of bundle.skills) {
    if (skill.source.type !== 'files') continue;
    for (const [path, content] of Object.entries(skill.source.files)) {
      const target = join(dir, 'skills', skill.name, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
    }
  }
  for (const agent of bundle.agents) {
    writeFileSync(join(dir, 'agents', `${agent.name}.md`), agentMarkdown(agent));
  }
}

// A bundle from a directory or from its one-document JSON form.
export function readBundle(path: string): TemplateBundle {
  if (statSync(path).isDirectory()) return readBundleDir(path);
  return JSON.parse(readFileSync(path, 'utf8')) as TemplateBundle;
}
