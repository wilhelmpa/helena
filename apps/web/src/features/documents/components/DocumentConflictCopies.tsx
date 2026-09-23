'use client';

import { Download, Trash2, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { vaultFileUrl } from '@/lib/api/endpoints/knowledge';
import { Button } from '@/components/ui/button';
import { useRelativeTime } from '@/context/relativeTimeContext';
import { useSyncConflictsQuery, useTrashVaultPath } from '../services/knowledge.service';
import { baseName } from '../utils/vaultPaths';

// The copies Syncthing kept of the open note, to compare by hand and then delete.
export default function DocumentConflictCopies({
  root,
  path,
  canEdit,
}: {
  root: string;
  path: string;
  canEdit: boolean;
}) {
  const t = useTranslations('documents');
  const relativeTime = useRelativeTime();
  const conflicts = useSyncConflictsQuery(root);
  const trash = useTrashVaultPath(root);
  const copies = (conflicts.data ?? []).filter((conflict) => conflict.original === path);
  if (copies.length === 0) return null;

  return (
    <ul className="shrink-0 divide-y divide-amber-500/20 border-b border-amber-500/25 bg-amber-500/10 text-xs text-amber-800 dark:text-amber-200">
      {copies.map((copy) => (
        <li key={copy.path} className="flex flex-wrap items-center gap-2 px-4 py-2">
          <TriangleAlert className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1">
            {t('conflictCopy', { time: relativeTime(copy.updatedAt) })}
          </span>
          <Button type="button" variant="ghost" size="sm" asChild>
            <a href={vaultFileUrl(copy.path)} download={baseName(copy.path)}>
              <Download />
              {t('downloadConflictCopy')}
            </a>
          </Button>
          {canEdit && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={trash.isPending}
              onClick={() => trash.mutate(copy.path)}
            >
              <Trash2 />
              {t('deleteConflictCopy')}
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
