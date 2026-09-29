import {
  BookOpen,
  Bot,
  Folder,
  Globe,
  Images,
  Inbox,
  ListChecks,
  Mail,
  MessageSquare,
  Network,
  Paperclip,
  ReceiptText,
  SquareCheckBig,
  type LucideIcon,
} from 'lucide-react';

const fixedFolders: Record<string, string> = {
  Docs: 'Dokumente',
  // Not "Dateien": that is the view of every file next to Wissen and Belege.
  Files: 'Ablage',
  Assets: 'Anhänge',
  Boards: 'Leinwände',
  Inbox: 'Eingang',
};

const fixedOrder = ['Docs', 'Files', 'Assets', 'Boards', 'Inbox'];
export type FixedFolderKey =
  | 'Docs'
  | 'Files'
  | 'Assets'
  | 'Boards'
  | 'Inbox'
  | 'DocsAgents'
  | 'FilesReceipts'
  | 'FilesMail'
  | 'FilesChat'
  | 'FilesBrowser'
  | 'FilesBoards'
  | 'FilesTasks';

export function knowledgeFolderLabel(
  name: string,
  translate?: (key: FixedFolderKey) => string,
): string {
  if (!Object.hasOwn(fixedFolders, name)) return name;
  if (translate) return translate(name as FixedFolderKey);
  return fixedFolders[name]!;
}

// Where the folders keep their own German names when no translation is at hand (tests).
const managedDefaults: Record<string, string> = {
  DocsAgents: 'Agenten',
  FilesReceipts: 'Belege',
  FilesMail: 'Mail',
  FilesChat: 'Chats',
  FilesBrowser: 'Browser',
  FilesBoards: 'Leinwände',
  FilesTasks: 'Aufgaben',
};

export function compareKnowledgeFolders(a: string, b: string): number {
  const first = fixedOrder.indexOf(a);
  const second = fixedOrder.indexOf(b);
  if (first !== -1 || second !== -1) {
    if (first === -1) return 1;
    if (second === -1) return -1;
    return first - second;
  }
  return a.localeCompare(b, 'de');
}

export function isDirectChildFolder(item: { kind: string; path: string }, parent: string): boolean {
  if (item.kind !== 'folder') return false;
  const prefix = parent ? `${parent}/` : '';
  if (!item.path.startsWith(prefix)) return false;
  return !item.path.slice(prefix.length).includes('/');
}

// The folders Helena makes and fills (relative to a project's folder): the fixed folders of
// a project and the ones inside them that Helena creates by itself (agents' notes,
// receipts, mail, chats, browser, boards, the folders of tasks). Each has its own symbol;
// every folder a person made shows the normal folder (owner, UI findings G; O77/O78).
const FIXED_ICONS: Record<string, LucideIcon> = {
  Docs: BookOpen,
  Files: Paperclip,
  Assets: Images,
  Boards: Network,
  Inbox: Inbox,
};

// A folder Helena creates inside a fixed one: its path, the key of its name and its symbol.
const MANAGED: Record<string, { key: FixedFolderKey; icon: LucideIcon }> = {
  'Docs/Agenten': { key: 'DocsAgents', icon: Bot },
  'Files/Belege': { key: 'FilesReceipts', icon: ReceiptText },
  'Files/Mail': { key: 'FilesMail', icon: Mail },
  'Files/Chat': { key: 'FilesChat', icon: MessageSquare },
  'Files/Browser': { key: 'FilesBrowser', icon: Globe },
  'Files/Boards': { key: 'FilesBoards', icon: Network },
  'Files/Tasks': { key: 'FilesTasks', icon: ListChecks },
};

// System folders hold what Helena files by itself, task folders what belongs to one task,
// every other folder is the owner's own.
export type FolderKind = 'system' | 'task' | 'custom';

export interface FolderInfo {
  kind: FolderKind;
  label: string;
  Icon: LucideIcon;
}

// The name of a folder Helena made from a slug ("planung-relaunch"): words apart, first
// letter capital. A name with spaces or dates keeps them; only a letter next to a hyphen
// or underscore turns it into a space.
export function readableFolderName(name: string): string {
  const spaced = name.replace(/(?<=\p{L})[-_]+|[-_]+(?=\p{L})/gu, ' ').trim();
  return spaced.charAt(0).toLocaleUpperCase() + spaced.slice(1);
}

// What a folder is and how it is shown, from its path relative to the project's folder
// (Docs, Files/Tasks/VOL-3, Files/Chat/planung-relaunch …). The one place for it: the
// sidebar tree, the folder page, the list and the overlay all ask here (O77/O78). The
// paths on disk never change; only what is shown.
export function describeFolder(
  path: string,
  translate?: (key: FixedFolderKey) => string,
  projectFolder = true,
): FolderInfo {
  const clean = path.replace(/^\/+|\/+$/g, '');
  const name = clean.split('/').at(-1) ?? clean;
  if (!projectFolder || !clean) return { kind: 'custom', label: name, Icon: Folder };
  const managedLabel = (key: FixedFolderKey) => translate?.(key) ?? managedDefaults[key] ?? key;
  if (Object.hasOwn(FIXED_ICONS, clean))
    return {
      kind: 'system',
      label: knowledgeFolderLabel(clean, translate),
      Icon: FIXED_ICONS[clean]!,
    };
  const managed = Object.hasOwn(MANAGED, clean) ? MANAGED[clean] : undefined;
  if (managed) return { kind: 'system', label: managedLabel(managed.key), Icon: managed.icon };
  const parts = clean.split('/');
  const parent = parts.slice(0, -1).join('/');
  if (parts.length === 3 && parent === 'Files/Tasks')
    return { kind: 'task', label: name, Icon: SquareCheckBig };
  // What Helena files into a folder of its own (a chat's, a mailbox's …) has its parent's
  // symbol and a readable name.
  const container = parts.length === 3 && Object.hasOwn(MANAGED, parent) ? MANAGED[parent] : null;
  if (container && parent !== 'Files/Boards')
    return { kind: 'system', label: readableFolderName(name), Icon: container.icon };
  return { kind: 'custom', label: name, Icon: Folder };
}

// The labels of every segment of a path, as the crumbs and the list's "where" show them.
export function folderPathLabels(
  segments: string[],
  translate?: (key: FixedFolderKey) => string,
  projectFolder = true,
): string[] {
  return segments.map(
    (_, index) =>
      describeFolder(segments.slice(0, index + 1).join('/'), translate, projectFolder).label,
  );
}

export function folderIcon(path: string, projectFolder = true): LucideIcon {
  return describeFolder(path, undefined, projectFolder).Icon;
}
