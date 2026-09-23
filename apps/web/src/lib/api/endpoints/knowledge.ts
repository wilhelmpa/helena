import { request, uploadFile } from '@/lib/api/core/client';

// The knowledge vault: Markdown notes and other files addressed by their vault-relative
// path ("Projects/VOL/Docs/Spec.md"). The files are the source of truth; a note is
// saved with the sha256 it was read at, and a note changed elsewhere since answers 409.

export type VaultEntryKind = 'note' | 'file' | 'folder';

export interface VaultTreeItem {
  path: string;
  name: string;
  kind: 'note' | 'folder';
  title: string;
  updatedAt: string | null;
}

export interface VaultTree {
  root: string;
  items: VaultTreeItem[];
}

export interface VaultFolderItem {
  path: string;
  name: string;
  kind: VaultEntryKind;
  title: string;
  mime: string | null;
  sizeBytes: number | null;
  updatedAt: string | null;
  extractionStatus: string | null;
}

export interface VaultDocument {
  path: string;
  kind: 'note' | 'file';
  title: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  updatedAt: string;
  projectKey: string | null;
  content: string;
  frontmatter: Record<string, unknown>;
  body: string;
  truncated: boolean;
  extractionStatus: string;
  absolutePath: string;
  obsidianUrl: string;
}

export interface WriteNoteInput {
  path: string;
  body: string;
  frontmatter: Record<string, unknown>;
  // null creates the note; a sha updates it while it still has that content.
  expectedSha: string | null;
}

export interface WrittenNote {
  path: string;
  sha256: string;
  created: boolean;
  title: string;
}

export interface KnowledgeSearchHit {
  path: string;
  title: string;
  kind: VaultEntryKind;
  projectKey: string | null;
  // Matches are wrapped in **…**.
  snippet: string;
  rank: number;
  updatedAt: string | null;
}

export interface LinkedNote {
  path: string;
  title: string;
  projectKey: string | null;
  updatedAt: string | null;
}

export interface TrashedNote {
  path: string;
  trashedAt: string;
}

// A copy Syncthing kept where two devices changed a note at the same time.
export interface SyncConflict {
  path: string;
  original: string;
  updatedAt: string;
}

export interface NoteRevision {
  commit: string;
  authorName: string;
  committedAt: string;
  message: string;
}

const query = (params: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  return search.toString();
};

export const getVaultTree = (root: string) =>
  request<VaultTree>(`/knowledge/tree?${query({ root })}`);

export const listVaultFolder = (path: string) =>
  request<{ path: string; items: VaultFolderItem[] }>(`/knowledge/folders?${query({ path })}`);

export const getVaultDocument = (path: string, signal?: AbortSignal) =>
  request<VaultDocument>(`/knowledge/documents?${query({ path })}`, { signal });

export const writeNote = (input: WriteNoteInput) =>
  request<WrittenNote>('/knowledge/notes', { method: 'PUT', body: JSON.stringify(input) });

// Writes the whole file, frontmatter included, as it is.
export const writeNoteContent = (input: { path: string; content: string; expectedSha: string }) =>
  request<WrittenNote>('/knowledge/notes', { method: 'PUT', body: JSON.stringify(input) });

export const createVaultFolder = (path: string) =>
  request<{ path: string }>('/knowledge/folders', {
    method: 'POST',
    body: JSON.stringify({ path }),
  });

export const moveVaultPath = (from: string, to: string) =>
  request<{ path: string }>('/knowledge/move', {
    method: 'POST',
    body: JSON.stringify({ from, to }),
  });

export const trashVaultPath = (path: string) =>
  request<{ path: string }>('/knowledge/trash', { method: 'POST', body: JSON.stringify({ path }) });

export const listVaultTrash = (path: string) =>
  request<TrashedNote[]>(`/knowledge/trash?${query({ path })}`);

export const restoreVaultPath = (path: string) =>
  request<{ path: string }>('/knowledge/restore', {
    method: 'POST',
    body: JSON.stringify({ path }),
  });

export const searchKnowledge = (q: string, folder?: string, limit = 20) =>
  request<{ items: KnowledgeSearchHit[] }>(`/knowledge/search?${query({ q, folder, limit })}`);

export const listBacklinks = (path: string) =>
  request<LinkedNote[]>(`/knowledge/backlinks?${query({ path })}`);

export const listTaskNotes = (identifier: string) =>
  request<LinkedNote[]>(`/knowledge/backlinks?${query({ task: identifier })}`);

export const resolveWikilink = (from: string, target: string) =>
  request<{ path: string | null }>(`/knowledge/wikilink?${query({ from, target })}`);

export const resolveVaultPath = (path: string) =>
  request<{ path: string | null }>(`/knowledge/resolve?${query({ path })}`);

export const listSyncConflicts = (root: string) =>
  request<SyncConflict[]>(`/knowledge/conflicts?${query({ root })}`);

export const listNoteHistory = (path: string) =>
  request<NoteRevision[]>(`/knowledge/history?${query({ path })}`);

export const getNoteVersion = (path: string, commit: string) =>
  request<{ path: string; commit: string; content: string }>(
    `/knowledge/history/version?${query({ path, commit })}`,
  );

export const uploadNoteAsset = (notePath: string, file: File) =>
  uploadFile<{ path: string }>(`/knowledge/assets?${query({ path: notePath })}`, 'POST', file);

// A vault file as the browser loads it: through the web origin, which forwards the
// session to the API (app/protected-media/knowledge/raw).
export const vaultFileUrl = (path: string) => `/protected-media/knowledge/raw?${query({ path })}`;
