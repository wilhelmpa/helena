import path from 'node:path';
import { HOME_DIR, PRIVATE_DIR, PROJECTS_DIR, TEMPLATES_DIR, vaultRoot } from '@repo/vault';
import { vaultScope, type VaultScope } from '#modules/knowledge/scope';

// The parts of the knowledge vault an agent reaches with its own file tools, as
// absolute paths, delivered to the runner as `vaultAccess` in the runtime policy. A path
// is readable when it is below an entry of `read` and below none of `deny`, writable
// when it is below an entry of `write` and below none of `deny`. The rules are the ones
// the knowledge MCP tools enforce (modules/knowledge/scope.ts); Hermes' approval plugin
// enforces them for the file tools.
export interface VaultAccess {
  root: string;
  read: string[];
  write: string[];
  deny: string[];
}

export function vaultAccessOf(scope: VaultScope, root: string): VaultAccess {
  const at = (...parts: string[]) => path.join(root, ...parts);
  const projects = [...scope.projects];
  const homeReadsAll = scope.home.read && scope.agent !== null;
  const read = homeReadsAll
    ? [root]
    : [
        ...projects.filter(([, access]) => access.read).map(([key]) => at(PROJECTS_DIR, key)),
        ...(scope.templates.read ? [at(TEMPLATES_DIR)] : []),
        ...(scope.home.read ? [at(HOME_DIR)] : []),
      ];
  const write = [
    ...projects.filter(([, access]) => access.write).map(([key]) => at(PROJECTS_DIR, key)),
    ...(scope.templates.write ? [at(TEMPLATES_DIR)] : []),
    ...(scope.home.write ? [at(HOME_DIR)] : []),
  ];
  const deny = [
    at('.git'),
    at('.obsidian'),
    at('.trash'),
    ...(scope.private ? [] : [at(PRIVATE_DIR)]),
  ];
  return { root, read, write, deny };
}

export async function agentVaultAccess(userId: string): Promise<VaultAccess> {
  return vaultAccessOf(await vaultScope({ id: userId }, false), vaultRoot());
}

// What an agent is told about the knowledge vault in its SOUL.md: where knowledge goes,
// how it is linked to the tasks, and which part of the vault it reaches.
export function knowledgeSection(access: VaultAccess): string {
  if (access.read.length === 0) return '';
  const relative = (absolute: string) => path.relative(access.root, absolute) || '(everything)';
  return [
    '## Knowledge',
    'The knowledge vault holds the notes and files of your projects: Markdown notes, PDFs,',
    "scans and office files, the same files the owner reads in Helena's Docs and in Obsidian.",
    'search_knowledge searches everything you may open at once: tasks and their comments,',
    'notes and files, mail, chats and agent runs. read_knowledge reads a hit by its ref;',
    'read_document reads a note or the text of a file by its path (and names the file on',
    'disk: look at an image or a scan with your vision tool there); list_folder lists a',
    'folder; backlinks finds the notes linking to a note or a task.',
    '- Before you research or decide something, search what is already known.',
    '- When an answer or a note uses what you found, cite it: put the `cite` link of the hit',
    '  after the statement it supports.',
    '- Save what is worth keeping but belongs nowhere yet with capture_note (a project Inbox),',
    '  and a web page with capture_web_page; both keep the source.',
    '- Put findings, decisions, research results and handovers into the project knowledge',
    '  as notes (write_note, Projects/<KEY>/Docs/...): one note per topic, a clear name.',
    '- Link the task a note belongs to with [[KEY-n]] in the note, and other notes with',
    '  [[Note name]]. The task then lists the note in its knowledge section.',
    '- Change a note with the sha256 read_document returned; after a conflict, read it',
    '  again and merge.',
    '- Your own memory stays yours; what others need to know goes into the vault.',
    `Vault: ${access.root}. You read: ${access.read.map(relative).join(', ')}.` +
      (access.write.length > 0 ? ` You write: ${access.write.map(relative).join(', ')}.` : '') +
      ` Never: ${access.deny.map(relative).join(', ')}.`,
  ].join('\n');
}
