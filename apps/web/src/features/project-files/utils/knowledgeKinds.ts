import {
  FileImage,
  FileText,
  FileType2,
  Folder,
  Network,
  TableProperties,
  type LucideIcon,
} from 'lucide-react';
import type { FileItem } from '@/lib/api/endpoints/projectFiles';

// The kinds Wissen distinguishes, with one icon each (docs/ui-system.md §8: one icon set,
// one color).
export type KnowledgeKind = 'folder' | 'canvas' | 'base' | 'doc' | 'pdf' | 'image' | 'file';

export const isDoc = (name: string) => /\.(md|markdown)$/i.test(name);
export const isCanvas = (name: string) => /\.canvas$/i.test(name);
// An Obsidian Base: a YAML view (table, cards, list) over notes.
export const isBase = (name: string) => /\.base$/i.test(name);
// What Wissen lists (the rest is Dateien): docs, canvases and views.
export const isKnowledge = (name: string) => isDoc(name) || isCanvas(name) || isBase(name);
export const isImage = (name: string) => /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(name);
export const isPdf = (name: string) => /\.pdf$/i.test(name);

export function knowledgeKind(item: Pick<FileItem, 'kind' | 'name'>): KnowledgeKind {
  if (item.kind === 'folder') return 'folder';
  if (isCanvas(item.name)) return 'canvas';
  if (isBase(item.name)) return 'base';
  if (isDoc(item.name)) return 'doc';
  if (isPdf(item.name)) return 'pdf';
  if (isImage(item.name)) return 'image';
  return 'file';
}

export const knowledgeIcons: Record<KnowledgeKind, LucideIcon> = {
  folder: Folder,
  canvas: Network,
  base: TableProperties,
  doc: FileText,
  pdf: FileType2,
  image: FileImage,
  file: FileText,
};

// A doc, canvas or view is shown by its name without the extension.
export const knowledgeDisplayName = (name: string) =>
  isKnowledge(name) ? name.replace(/\.(md|markdown|canvas|base)$/i, '') : name;

// A name typed while renaming in place (Auftrag 117): a doc, canvas or view is shown and
// typed without its extension, so it keeps the one it had; any other file is taken as typed.
export function renamedFileName(original: string, typed: string): string {
  const name = typed.trim();
  const extension = /\.(md|markdown|canvas|base)$/i.exec(original)?.[0];
  if (!extension || /\.[a-z0-9]+$/i.test(name)) return name;
  return `${name}${extension}`;
}
