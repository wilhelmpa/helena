import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createFolder,
  createTextFile,
  moveFile,
  trashFile,
  uploadFiles,
  type FileScope,
} from '@/lib/api/endpoints/projectFiles';
import { filesScopeKey } from '@/services/files.service';

// The writes of the Files page. Each refreshes every listing of its scope, since a
// move changes two folders and a new folder shows in its parent.
function useScopeMutation<T, R>(scope: FileScope, run: (input: T) => Promise<R>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => client.invalidateQueries({ queryKey: filesScopeKey(scope) }),
  });
}

export const useCreateFolder = (scope: FileScope) =>
  useScopeMutation(scope, (path: string) => createFolder(scope, path));

export const useCreateTextFile = (scope: FileScope) =>
  useScopeMutation(scope, (input: { path: string; content: string }) =>
    createTextFile(scope, input.path, input.content),
  );

export const useUploadFiles = (scope: FileScope) =>
  useScopeMutation(scope, (input: { folder: string; files: File[] }) =>
    uploadFiles(scope, input.folder, input.files),
  );

export const useMoveFile = (scope: FileScope) =>
  useScopeMutation(scope, (input: { from: string; to: string }) =>
    moveFile(scope, input.from, input.to),
  );

export const useTrashFile = (scope: FileScope) =>
  useScopeMutation(scope, (path: string) => trashFile(scope, path));
