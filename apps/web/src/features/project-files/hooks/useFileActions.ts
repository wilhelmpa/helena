import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  fileRawUrl,
  type FileItem,
  type FileList,
  type FileScope,
} from '@/lib/api/endpoints/projectFiles';
import { copyText } from '@/utils/clipboard';
import { runtimeEnv } from '@/utils/runtimeEnv';
import { fileViewKind } from '@/utils/fileKinds';
import { childPath, docsFileUrl, notesFileUrl } from '@/utils/vaultLinks';
import { codeFolderUrl } from '@/utils/workspaceTools';

// What can be done with one entry of the listed folder, and where each of its links
// leads. The dialogs are the caller's; `ask` opens one for an entry.
export type FileDialog = 'rename' | 'move' | 'trash' | 'link';

export function useFileActions({
  scope,
  listing,
  onNavigate,
  onSelect,
  ask,
}: {
  scope: FileScope;
  listing: FileList | undefined;
  onNavigate: (path: string) => void;
  onSelect: (path: string) => void;
  ask: (dialog: FileDialog, item: FileItem) => void;
}) {
  const t = useTranslations('files');
  const router = useRouter();
  const workspace = runtimeEnv().workspace;
  const projectKey = scope.kind === 'project' && scope.root === 'vault' ? scope.projectKey : null;

  const vaultPath = (item: FileItem) =>
    listing?.vaultPath != null ? childPath(listing.vaultPath, item.name) : null;
  const absolutePath = (item: FileItem) =>
    listing ? `${listing.absolutePath}/${item.name}` : item.path;

  return {
    ask,
    projectKey,
    vaultPath,
    open(item: FileItem) {
      if (item.kind === 'folder') return onNavigate(item.path);
      const path = vaultPath(item);
      if (projectKey && path && fileViewKind(item.name) === 'markdown') {
        return router.push(docsFileUrl(projectKey, path));
      }
      onSelect(item.path);
    },
    downloadUrl: (item: FileItem) => fileRawUrl(scope, item.path, true),
    // The file in the notes (a new tab on their own origin), where this origin has them.
    notesUrl(item: FileItem) {
      const path = vaultPath(item);
      return path ? notesFileUrl(workspace.notesUrl, path) : '';
    },
    codeUrl(item: FileItem) {
      const folder = item.kind === 'folder' ? absolutePath(item) : listing?.absolutePath;
      return folder ? codeFolderUrl(workspace, folder) : '';
    },
    async copyPath(item: FileItem) {
      try {
        await copyText(absolutePath(item));
        toast.success(t('pathCopied'));
      } catch {
        toast.error(t('copyFailed'));
      }
    },
  };
}

export type FileActions = ReturnType<typeof useFileActions>;
