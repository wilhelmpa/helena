import { usePathname, useRouter } from 'next/navigation';
import { vaultNotePath } from '@/utils/paths';
import { useMoveVaultPath, useTrashVaultPath } from '../services/knowledge.service';
import {
  baseName,
  cleanFileName,
  isNotePath,
  isWithin,
  joinPath,
  parentPath,
} from '../utils/vaultPaths';

// Rename, move and trash for a note or folder. When the open note is affected, its
// edits are saved first (`flush`) and the address follows it to its new path.
export function useVaultPathActions({
  root,
  openPath,
  flush,
}: {
  root: string;
  openPath: string | null;
  flush: () => Promise<boolean>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const move = useMoveVaultPath(root);
  const trash = useTrashVaultPath(root);
  const affectsOpen = (path: string) => openPath !== null && isWithin(openPath, path);

  const relocate = async (from: string, to: string) => {
    if (from === to) return;
    const open = affectsOpen(from);
    if (open && !(await flush())) return;
    await move.mutateAsync({ from, to });
    if (open) router.replace(vaultNotePath(to + openPath!.slice(from.length)));
  };

  const rename = async (path: string, name: string) => {
    const clean = cleanFileName(name);
    if (!clean) return;
    await relocate(path, joinPath(parentPath(path), isNotePath(path) ? `${clean}.md` : clean));
  };

  const moveTo = (path: string, folder: string) => relocate(path, joinPath(folder, baseName(path)));

  const remove = async (path: string) => {
    const open = affectsOpen(path);
    if (open) await flush();
    await trash.mutateAsync(path);
    if (open) router.replace(pathname);
  };

  return { rename, moveTo, remove };
}

export type VaultPathActions = ReturnType<typeof useVaultPathActions>;
