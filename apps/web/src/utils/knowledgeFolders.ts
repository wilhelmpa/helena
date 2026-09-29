import {
  BookOpen,
  Bot,
  Folder,
  Globe,
  Images,
  Inbox,
  Mail,
  MessageSquare,
  Network,
  Paperclip,
  ReceiptText,
  type LucideIcon,
} from 'lucide-react';

const fixedFolders: Record<string, string> = {
  Docs: 'Dokumente',
  Files: 'Dateien',
  Assets: 'Anhänge',
  Boards: 'Leinwände',
  Inbox: 'Eingang',
};

const fixedOrder = ['Docs', 'Files', 'Assets', 'Boards', 'Inbox'];
export type FixedFolderKey = 'Docs' | 'Files' | 'Assets' | 'Boards' | 'Inbox';

export function knowledgeFolderLabel(
  name: string,
  translate?: (key: FixedFolderKey) => string,
): string {
  if (!Object.hasOwn(fixedFolders, name)) return name;
  if (translate) return translate(name as FixedFolderKey);
  return fixedFolders[name]!;
}

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

// The folders Helena makes and fills (relative to a project's folder) have their own
// symbol; every folder a person made shows the normal folder (owner, UI findings G).
const SYSTEM_FOLDER_ICONS: Record<string, LucideIcon> = {
  Docs: BookOpen,
  'Docs/Agenten': Bot,
  Files: Paperclip,
  'Files/Belege': ReceiptText,
  'Files/Mail': Mail,
  'Files/Chat': MessageSquare,
  'Files/Browser': Globe,
  'Files/Boards': Network,
  Assets: Images,
  Boards: Network,
  Inbox: Inbox,
};

export function folderIcon(path: string, projectFolder = true): LucideIcon {
  return (projectFolder && SYSTEM_FOLDER_ICONS[path.replace(/\/+$/, '')]) || Folder;
}
