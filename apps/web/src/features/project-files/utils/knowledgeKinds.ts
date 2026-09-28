import { FileImage, FileText, FileType2, Folder, Network, type LucideIcon } from 'lucide-react';
import type { FileItem } from '@/lib/api/endpoints/projectFiles';

// The kinds Wissen distinguishes, with one icon each (docs/ui-system.md §8: one icon set,
// one color).
export type KnowledgeKind = 'folder' | 'canvas' | 'doc' | 'pdf' | 'image' | 'file';

export const isDoc = (name: string) => /\.(md|markdown)$/i.test(name);
export const isCanvas = (name: string) => /\.canvas$/i.test(name);
export const isImage = (name: string) => /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(name);
export const isPdf = (name: string) => /\.pdf$/i.test(name);

export function knowledgeKind(item: Pick<FileItem, 'kind' | 'name'>): KnowledgeKind {
  if (item.kind === 'folder') return 'folder';
  if (isCanvas(item.name)) return 'canvas';
  if (isDoc(item.name)) return 'doc';
  if (isPdf(item.name)) return 'pdf';
  if (isImage(item.name)) return 'image';
  return 'file';
}

export const knowledgeIcons: Record<KnowledgeKind, LucideIcon> = {
  folder: Folder,
  canvas: Network,
  doc: FileText,
  pdf: FileType2,
  image: FileImage,
  file: FileText,
};

// A doc or canvas is shown by its name without the extension.
export const knowledgeDisplayName = (name: string) =>
  isDoc(name) || isCanvas(name) ? name.replace(/\.(md|markdown|canvas)$/i, '') : name;
