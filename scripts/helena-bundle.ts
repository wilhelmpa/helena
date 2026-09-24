// Helena template bundles: agent templates, the skills they use and the MCP servers
// they need, as files that are imported into a Helena team and exported from one
// (owner, 2026-09-24: "Helena als Framework", extension point "Vorlagen und Pakete").
// This file is the format, version 1, with no I/O. It is the draft that hub/framework
// takes over into @helena/sdk. Why it looks like this: docs/helena-decisions/
// template-bundles.md.
//
// The format follows what agent tools already share, and only adds what Helena needs:
// - Skills are Agent Skills (a folder with SKILL.md and Markdown next to it).
// - An agent template is an agent file: Markdown whose YAML frontmatter uses the keys
//   Claude Code subagents use (name, description, model, effort, maxTurns,
//   disallowedTools, skills, mcpServers) and whose body is the instructions. What only
//   Helena has sits under one `helena` key.
// - MCP servers use the `mcpServers` shape of .mcp.json.
// - The directory form is laid out like a Claude Code plugin (agents/, skills/,
//   .mcp.json) with helena.bundle.json as its manifest.
//
// Two forms, same content: a directory (people, git; helena-bundle-files.ts reads and
// writes it) and one JSON document, the TemplateBundle (upload, download, browser).
// A bundle never holds a secret, a project, a person or an id, so it can be shared.

export const BUNDLE_FORMAT = 'helena.template-bundle';
export const BUNDLE_FORMAT_VERSION = 1;
export const BUNDLE_MANIFEST = 'helena.bundle.json';

export type SkillSource =
  { type: 'github'; url: string } | { type: 'files'; files: Record<string, string> };

export interface BundleSkill {
  // The SKILL.md frontmatter name, which Helena stores as the skill's name.
  name: string;
  source: SkillSource;
  // SPDX identifier.
  license: string;
  // What the license asks to be kept when the text is passed on.
  attribution: string;
}

// One entry of .mcp.json's `mcpServers`. No env and no headers in version 1: they are
// where credentials go, and a bundle carries none.
export interface BundleMcpServer {
  type: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
  // Helena shows it in the MCP library.
  description?: string;
}

export interface BundleAgent {
  // The identifier (Claude Code subagent `name`), Helena's mention handle. A project's
  // copy is "<name>-<project key>".
  name: string;
  // When to use it, one sentence.
  description: string;
  // The Markdown body: the agent's instructions.
  instructions: string;
  // A model id the team's runners publish, or null for the runner's default.
  model: string | null;
  // Reasoning effort, or null for the model's default.
  effort: string | null;
  maxTurns: number | null;
  // Hermes toolsets the agent's copies may not use.
  disallowedTools: string[];
  skills: string[];
  mcpServers: string[];
  helena: {
    // Shown in Helena; a copy is "<displayName> <PROJECT KEY>".
    displayName: string;
    roleTitle: string;
    // Routing keywords a workflow role can match; a role matched by capability needs
    // exactly one agent of a project to carry it.
    capabilities: string[];
    runBudgetSeconds: number | null;
    triggers: { mention: boolean; assign: boolean };
  };
}

export interface TemplateBundle {
  format: typeof BUNDLE_FORMAT;
  formatVersion: typeof BUNDLE_FORMAT_VERSION;
  // Kebab-case identifier, e.g. "helena-agent-pool".
  name: string;
  displayName: string;
  // Semantic version.
  version: string;
  description: string;
  // License of the bundle's own files (agents and file skills).
  license: string;
  author: { name: string; url?: string };
  skills: BundleSkill[];
  mcpServers: Record<string, BundleMcpServer>;
  agents: BundleAgent[];
}

// The licenses a bundle skill may carry: what fits Helena's AGPL-3.0.
export const ACCEPTED_LICENSES = new Set([
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'MPL-2.0',
  'CC-BY-4.0',
  'CC0-1.0',
  'AGPL-3.0-only',
]);

const KEBAB = /^[a-z0-9][a-z0-9-]{0,63}$/;
const HANDLE = /^[a-zA-Z0-9._-]{1,64}$/;
const CAPABILITY = /^[a-z0-9][a-z0-9-]{0,31}$/;
const MCP_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const PINNED_GITHUB = /^https:\/\/github\.com\/[^/]+\/[^/]+\/tree\/[0-9a-f]{40}(\/[^?#]*)?$/;
const REF_PATH = /^refs\/[A-Za-z0-9][A-Za-z0-9._-]*\.md$/;

// The frontmatter name of a SKILL.md, or undefined.
export function skillMarkdownName(markdown: string): string | undefined {
  const block = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/.exec(markdown)?.[1];
  const line = block?.split(/\r?\n/).find((l) => /^name\s*:/.test(l));
  return line
    ?.replace(/^name\s*:\s*/, '')
    .replace(/^["']|["']$/g, '')
    .trim();
}

function validateSkill(skill: BundleSkill, problems: string[]): void {
  const where = `skill ${skill.name}`;
  if (!KEBAB.test(skill.name)) problems.push(`${where}: name is not kebab-case`);
  if (!ACCEPTED_LICENSES.has(skill.license)) problems.push(`${where}: license ${skill.license}`);
  if (!skill.attribution?.trim()) problems.push(`${where}: no attribution`);
  if (skill.source.type === 'github') {
    if (!PINNED_GITHUB.test(skill.source.url))
      problems.push(`${where}: GitHub source is not pinned to a commit`);
    return;
  }
  const markdown = skill.source.files['SKILL.md'];
  if (!markdown) problems.push(`${where}: no SKILL.md`);
  else if (skillMarkdownName(markdown) !== skill.name)
    problems.push(`${where}: SKILL.md is named ${skillMarkdownName(markdown)}`);
  for (const path of Object.keys(skill.source.files)) {
    if (path !== 'SKILL.md' && !REF_PATH.test(path))
      problems.push(`${where}: ${path} is not refs/<file>.md`);
  }
}

function validateMcpServer(name: string, server: BundleMcpServer, problems: string[]): void {
  const where = `MCP server ${name}`;
  if (!MCP_NAME.test(name)) problems.push(`${where}: name`);
  if (server.type === 'stdio' ? !server.command : !server.url)
    problems.push(`${where}: ${server.type === 'stdio' ? 'no command' : 'no url'}`);
  if ('env' in server || 'headers' in server)
    problems.push(`${where}: env and headers are not allowed in a bundle`);
}

function validateAgent(
  agent: BundleAgent,
  bundle: TemplateBundle,
  skills: Set<string>,
  capabilities: Map<string, string>,
  problems: string[],
): void {
  const where = `agent ${agent.name}`;
  if (!HANDLE.test(agent.name)) problems.push(`${where}: name is not a handle`);
  if (!agent.description?.trim()) problems.push(`${where}: no description`);
  if (!agent.instructions?.trim()) problems.push(`${where}: no instructions`);
  if (!agent.helena?.displayName?.trim()) problems.push(`${where}: no helena.displayName`);
  for (const name of agent.skills) {
    if (!skills.has(name)) problems.push(`${where}: skill ${name} is not in the bundle`);
  }
  for (const name of agent.mcpServers) {
    if (!bundle.mcpServers[name])
      problems.push(`${where}: MCP server ${name} is not in the bundle`);
  }
  if (agent.maxTurns != null && !(agent.maxTurns >= 1 && agent.maxTurns <= 200))
    problems.push(`${where}: maxTurns out of 1–200`);
  const budget = agent.helena?.runBudgetSeconds;
  if (budget != null && !(budget >= 60 && budget <= 7200))
    problems.push(`${where}: runBudgetSeconds out of 60–7200`);
  const list = agent.helena?.capabilities ?? [];
  if (list.length > 16) problems.push(`${where}: more than 16 capabilities`);
  for (const capability of list) {
    if (!CAPABILITY.test(capability)) problems.push(`${where}: capability ${capability}`);
    const other = capabilities.get(capability);
    if (other) problems.push(`${where}: capability ${capability} is also on ${other}`);
    capabilities.set(capability, agent.name);
  }
}

// Everything wrong with a bundle, as readable lines. An empty list means it is valid.
export function validateBundle(bundle: TemplateBundle): string[] {
  const problems: string[] = [];
  if (bundle.format !== BUNDLE_FORMAT) problems.push(`format is not ${BUNDLE_FORMAT}`);
  if (bundle.formatVersion !== BUNDLE_FORMAT_VERSION)
    problems.push(`formatVersion ${String(bundle.formatVersion)} is not ${BUNDLE_FORMAT_VERSION}`);
  if (!KEBAB.test(bundle.name ?? '')) problems.push('name is not kebab-case');
  for (const field of ['displayName', 'version', 'description', 'license'] as const) {
    if (!bundle[field]?.trim()) problems.push(`${field} is empty`);
  }
  if (!ACCEPTED_LICENSES.has(bundle.license)) problems.push(`license ${bundle.license}`);

  const skills = new Set<string>();
  for (const skill of bundle.skills) {
    if (skills.has(skill.name)) problems.push(`skill ${skill.name}: listed twice`);
    skills.add(skill.name);
    validateSkill(skill, problems);
  }
  for (const [name, server] of Object.entries(bundle.mcpServers)) {
    validateMcpServer(name, server, problems);
  }
  const handles = new Set<string>();
  const capabilities = new Map<string, string>();
  for (const agent of bundle.agents) {
    if (handles.has(agent.name.toLowerCase())) problems.push(`agent ${agent.name}: listed twice`);
    handles.add(agent.name.toLowerCase());
    validateAgent(agent, bundle, skills, capabilities, problems);
  }
  return problems;
}

// A bundle from JSON of unknown origin: checked before anything uses it.
export function parseBundleJson(text: string): TemplateBundle {
  const bundle = JSON.parse(text) as TemplateBundle;
  if (!bundle || typeof bundle !== 'object' || !Array.isArray(bundle.agents)) {
    throw new Error('Not a Helena template bundle');
  }
  const problems = validateBundle(bundle);
  if (problems.length > 0) throw new Error(`Invalid bundle:\n- ${problems.join('\n- ')}`);
  return bundle;
}
