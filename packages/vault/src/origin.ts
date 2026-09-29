// Where a vault file came from, as the owner sees it (UI findings G, O51): made by Helena
// itself (receipts, mail attachments, generated projections and exports), by an agent, or by
// a person (an upload, an edit in Helena or Obsidian). One place decides it, so every list
// shows the same answer.
export type VaultOrigin = 'system' | 'agent' | 'manual';

const ORIGINS = new Set<VaultOrigin>(['system', 'agent', 'manual']);

// Folders Helena fills by itself, relative to a project's folder. Their files are "system"
// unless their front matter says otherwise.
const SYSTEM_FOLDERS = ['Files/Belege', 'Files/Mail', 'Docs/Agenten'];
// Folders agents fill: the final frames of browser runs.
const AGENT_FOLDERS = ['Files/Browser'];

function inFolders(vaultPath: string, folders: string[]): boolean {
  const parts = vaultPath.split('/');
  if (parts[0] !== 'Projects' || parts.length < 4) return false;
  const inProject = parts.slice(2).join('/');
  return folders.some((folder) => inProject === folder || inProject.startsWith(`${folder}/`));
}

export function isSystemVaultPath(vaultPath: string): boolean {
  return inFolders(vaultPath, SYSTEM_FOLDERS);
}

// `frontmatter.origin` wins when it names one of the three; a generated projection is the
// system's; then the folder; then who wrote the file last through Helena (`agent:<id>`).
// Anything else — a person, Obsidian, an unknown writer — counts as manual.
export function vaultOrigin(entry: {
  path: string;
  frontmatter?: Record<string, unknown> | null;
  lastAuthor?: string | null;
}): VaultOrigin {
  const declared = entry.frontmatter?.origin;
  if (typeof declared === 'string' && ORIGINS.has(declared as VaultOrigin))
    return declared as VaultOrigin;
  if (entry.frontmatter?.generated === true) return 'system';
  if (isSystemVaultPath(entry.path)) return 'system';
  if (inFolders(entry.path, AGENT_FOLDERS)) return 'agent';
  if (entry.lastAuthor?.startsWith('agent:')) return 'agent';
  if (entry.lastAuthor === 'system') return 'system';
  return 'manual';
}
