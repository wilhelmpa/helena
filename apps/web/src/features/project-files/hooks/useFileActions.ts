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
import { filesPath, vaultNotePath } from '@/utils/paths';
import { codeFolderUrl } from '@/utils/workspaceTools';
import { vaultFilePath } from '../utils/vaultFilePath';

// What can be done with one entry of the listed folder, and where each of its links
// leads. The dialogs are the caller's; `ask` opens one for an entry.
export type FileDialog = 'rename' | 'move' | 'trash' | 'link';

export function useFileActions({
  scope,
  listing,
  onNavigate,
  onSelect,
  ask,
  inlineMarkdown = false,
}: {
  scope: FileScope;
  listing: FileList | undefined;
  onNavigate: (path: string) => void;
  onSelect: (path: string) => void;
  ask: (dialog: FileDialog, item: FileItem) => void;
  inlineMarkdown?: boolean;
}) {
  const t = useTranslations('files');
  const router = useRouter();
  const workspace = runtimeEnv().workspace;
  const projectKey = scope.kind === 'project' && scope.root === 'vault' ? scope.projectKey : null;

  const vaultPath = (item: FileItem) => vaultFilePath(scope, item.path);
  const absolutePath = (item: FileItem) =>
    listing ? `${listing.absolutePath}/${item.name}` : item.path;

  return {
    ask,
    projectKey,
    vaultPath,
    open(item: FileItem) {
      if (item.kind === 'folder') return onNavigate(item.path);
      const canonical = vaultPath(item);
      if (
        canonical &&
        !inlineMarkdown &&
        (/\.md$/i.test(item.name) || (projectKey && /\.canvas$/i.test(item.name)))
      )
        return router.push(vaultNotePath(canonical));
      onSelect(item.path);
    },
    downloadUrl: (item: FileItem) => fileRawUrl(scope, item.path, true),
    codeUrl(item: FileItem) {
      const folder = item.kind === 'folder' ? absolutePath(item) : listing?.absolutePath;
      return folder ? codeFolderUrl(workspace, folder) : '';
    },
    async copyPath(item: FileItem) {
      try {
        const canonical = vaultPath(item);
        const parent = item.path.includes('/')
          ? item.path.slice(0, item.path.lastIndexOf('/'))
          : '';
        await copyText(
          projectKey
            ? `${window.location.origin}${filesPath(projectKey, item.kind === 'folder' ? item.path : parent, { file: item.kind === 'file' ? item.path : null })}`
            : canonical
              ? `${window.location.origin}${vaultNotePath(canonical)}`
              : absolutePath(item),
        );
        toast.success(t('pathCopied'));
      } catch {
        toast.error(t('copyFailed'));
      }
    },
  };
}

export type FileActions = ReturnType<typeof useFileActions>;
