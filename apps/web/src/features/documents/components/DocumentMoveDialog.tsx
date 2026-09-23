'use client';

import { useState } from 'react';
import { Check, Folder } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Modal from '@/components/common/overlay/Modal';
import { Skeleton } from '@/components/ui/skeleton';
import { useVaultTreeQuery } from '../services/knowledge.service';
import { buildVaultTree, type VaultTreeNode } from '../utils/vaultTree';
import { baseName, isWithin, noteName, parentPath } from '../utils/vaultPaths';

function folderRows(nodes: VaultTreeNode[], skip: string, depth = 1): [string, number][] {
  return nodes.flatMap((node) =>
    node.item.kind === 'folder' && !isWithin(node.item.path, skip)
      ? [[node.item.path, depth], ...folderRows(node.children, skip, depth + 1)]
      : [],
  );
}

export default function DocumentMoveDialog({
  root,
  path,
  onMove,
  onClose,
}: {
  root: string;
  path: string;
  onMove: (folder: string) => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslations('documents');
  const tree = useVaultTreeQuery(root);
  const [busy, setBusy] = useState(false);
  const current = parentPath(path);
  const folders: [string, number][] = [
    [root, 0],
    ...folderRows(buildVaultTree(tree.data?.items ?? [], root), path),
  ];

  const choose = async (folder: string) => {
    if (folder === current) return;
    setBusy(true);
    try {
      await onMove(folder);
      onClose();
    } catch {
      setBusy(false);
    }
  };

  return (
    <Modal title={t('moveTitle', { name: noteName(path) })} onClose={onClose}>
      {tree.isPending ? (
        <div className="space-y-1.5" aria-hidden>
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-4/5" />
        </div>
      ) : (
        <ul className="space-y-px" aria-busy={busy}>
          {folders.map(([folder, depth]) => (
            <li key={folder}>
              <button
                type="button"
                disabled={busy}
                className="flex h-8 w-full items-center gap-2 rounded-md pe-2 text-start text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                style={{ paddingInlineStart: `${8 + depth * 16}px` }}
                onClick={() => void choose(folder)}
              >
                <Folder className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate" dir="auto">
                  {folder === root ? t('title') : baseName(folder)}
                </span>
                {folder === current && <Check className="size-4 shrink-0 text-primary" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
