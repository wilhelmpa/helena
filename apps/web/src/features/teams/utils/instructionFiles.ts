import type { AgentRuntimeFile } from '@/lib/api/endpoints/agents';

// The managed Markdown files of an agent (runtime policy files): SOUL.md, its identity, and
// any number of instruction files under instructions/. SOUL is edited as its own field; the
// rest as a list.
export const SOUL_FILE = 'SOUL.md';
export const INSTRUCTIONS_DIR = 'instructions/';

export function soulOf(files: AgentRuntimeFile[]): string {
  return files.find((file) => file.path === SOUL_FILE)?.content ?? '';
}

// The files with SOUL.md set to the text; an empty text removes the file.
export function withSoul(files: AgentRuntimeFile[], content: string): AgentRuntimeFile[] {
  const others = files.filter((file) => file.path !== SOUL_FILE);
  return content.trim() ? [{ kind: 'instructions', path: SOUL_FILE, content }, ...others] : others;
}

export function extraFiles(files: AgentRuntimeFile[]): AgentRuntimeFile[] {
  return files.filter((file) => file.path !== SOUL_FILE);
}

// A file name as typed ("regeln", "team/regeln.md") to its path under instructions/, or null
// when it cannot be one (the API's pattern: letters, digits, dot, dash, underscore; ".md").
export function instructionPath(name: string): string | null {
  const cleaned = name
    .trim()
    .replace(/^instructions\//, '')
    .replace(/\.md$/i, '');
  if (!cleaned) return null;
  const parts = cleaned.split('/');
  if (parts.length > 7 || !parts.every((part) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part))) {
    return null;
  }
  return `${INSTRUCTIONS_DIR}${cleaned}.md`;
}

// What a file is called on screen: "instructions/team/regeln.md" → "team/regeln".
export function instructionLabel(path: string): string {
  return path.replace(/^instructions\//, '').replace(/\.md$/i, '');
}
