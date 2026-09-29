import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/core/client';
import {
  createVaultFolder,
  getNoteVersion,
  getVaultDocument,
  getVaultDeletePreview,
  getVaultTree,
  listBacklinks,
  listNoteHistory,
  listSyncConflicts,
  listVaultTrash,
  moveVaultPath,
  resolveVaultPath,
  restoreVaultPath,
  trashVaultPath,
  uploadNoteAsset,
  vaultFileUrl,
  writeNote,
  writeNoteContent,
  type VaultTree,
  type WriteNoteInput,
} from '@/lib/api/endpoints/knowledge';
import { qk } from '@/services/queryKeys';
import { untitledNotePath } from '../utils/untitledNote';

// A request that answers 409 "exists" did not create anything, so another name is tried.
const MAX_NAME_ATTEMPTS = 50;

export const isApiStatus = (error: unknown, status: number, code?: string) =>
  error instanceof ApiError &&
  error.status === status &&
  (code === undefined || error.code === code);

function useInvalidateTree(root: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: qk.knowledgeTree(root) });
    void qc.invalidateQueries({ queryKey: qk.knowledgeTrash(root) });
  };
}

export function useVaultTreeQuery(root: string) {
  return useQuery({ queryKey: qk.knowledgeTree(root), queryFn: () => getVaultTree(root) });
}

export function useVaultTrashQuery(root: string, enabled: boolean) {
  return useQuery({
    queryKey: qk.knowledgeTrash(root),
    queryFn: () => listVaultTrash(root),
    enabled,
  });
}

export function useVaultDeletePreviewQuery(path: string | null) {
  return useQuery({
    queryKey: qk.knowledgeDeletePreview(path ?? ''),
    queryFn: () => getVaultDeletePreview(path!),
    enabled: path !== null,
  });
}

export function useSyncConflictsQuery(root: string) {
  return useQuery({
    queryKey: qk.knowledgeConflicts(root),
    queryFn: () => listSyncConflicts(root),
  });
}

export function useVaultNoteQuery(path: string | null) {
  return useQuery({
    queryKey: qk.knowledgeDocument(path ?? ''),
    queryFn: ({ signal }) => getVaultDocument(path!, signal),
    enabled: path !== null,
    retry: (count, error) => !isApiStatus(error, 404) && count < 1,
  });
}

// Where a note that is gone from its path was moved to.
export function useResolvedPathQuery(path: string, enabled: boolean) {
  return useQuery({
    queryKey: [...qk.knowledgeDocument(path), 'resolve'],
    queryFn: () => resolveVaultPath(path),
    enabled,
  });
}

export function useBacklinksQuery(path: string) {
  return useQuery({ queryKey: qk.knowledgeBacklinks(path), queryFn: () => listBacklinks(path) });
}

export function useNoteHistoryQuery(path: string, enabled: boolean) {
  return useQuery({
    queryKey: qk.knowledgeHistory(path),
    queryFn: () => listNoteHistory(path),
    enabled,
  });
}

export function useNoteVersionQuery(path: string, commit: string | null) {
  return useQuery({
    queryKey: [...qk.knowledgeHistory(path), commit],
    queryFn: () => getNoteVersion(path, commit!),
    enabled: commit !== null,
    staleTime: Infinity,
  });
}

export function useCreateUntitledNote(root: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateTree(root);
  return useMutation({
    mutationFn: async ({ folder, name }: { folder: string; name: string }) => {
      const tree = qc.getQueryData<VaultTree>(qk.knowledgeTree(root));
      const taken = new Set(tree?.items.map((item) => item.path));
      for (let attempt = 1; ; attempt += 1) {
        const path = untitledNotePath(folder, name, taken);
        try {
          await writeNote({ path, body: '', frontmatter: {}, expectedSha: null });
          return path;
        } catch (error) {
          if (!isApiStatus(error, 409, 'exists') || attempt === MAX_NAME_ATTEMPTS) throw error;
          taken.add(path);
        }
      }
    },
    onSuccess: invalidate,
  });
}

// Creates an empty note at a path; one that exists already is opened as it is.
export function useCreateNoteAt(root: string) {
  const invalidate = useInvalidateTree(root);
  return useMutation({
    mutationFn: async (path: string) => {
      try {
        await writeNote({ path, body: '', frontmatter: {}, expectedSha: null });
      } catch (error) {
        if (!isApiStatus(error, 409, 'exists')) throw error;
      }
      return path;
    },
    onSuccess: invalidate,
  });
}

export function useCreateFolder(root: string) {
  const invalidate = useInvalidateTree(root);
  return useMutation({ mutationFn: createVaultFolder, onSuccess: invalidate });
}

export function useMoveVaultPath(root: string) {
  const invalidate = useInvalidateTree(root);
  return useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) => moveVaultPath(from, to),
    onSuccess: invalidate,
  });
}

export function useTrashVaultPath(root: string) {
  const invalidate = useInvalidateTree(root);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: string | { path: string; confirmContents?: string }) =>
      typeof input === 'string'
        ? trashVaultPath(input)
        : trashVaultPath(input.path, input.confirmContents),
    onSuccess: () => {
      invalidate();
      void qc.invalidateQueries({ queryKey: qk.knowledgeConflicts(root) });
    },
  });
}

export function useRestoreVaultPath(root: string) {
  const invalidate = useInvalidateTree(root);
  return useMutation({ mutationFn: restoreVaultPath, onSuccess: invalidate });
}

// `quiet` for the autosave, which shows its own failure next to the note.
export function useWriteNote({ quiet = false } = {}) {
  return useMutation({
    mutationFn: (input: WriteNoteInput) => writeNote(input),
    meta: quiet ? { suppressErrorToast: true } : undefined,
  });
}

// Writes an earlier version back; the editor reloads it from the refetched note.
export function useRestoreNoteVersion(path: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ content, expectedSha }: { content: string; expectedSha: string }) =>
      writeNoteContent({ path, content, expectedSha }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.knowledgeDocument(path) }),
  });
}

export function useUploadNoteAsset(notePath: string) {
  return useMutation({
    mutationFn: async (file: File) => {
      const { path } = await uploadNoteAsset(notePath, file);
      return { url: vaultFileUrl(path), filename: file.name };
    },
  });
}
