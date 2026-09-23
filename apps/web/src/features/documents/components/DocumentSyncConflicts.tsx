'use client';

import Link from 'next/link';
import { TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { vaultNotePath } from '@/utils/paths';
import { useSyncConflictsQuery } from '../services/knowledge.service';
import { noteName } from '../utils/vaultPaths';

// The notes of the Docs that Syncthing kept a conflict copy of. Each opens the note,
// which shows its copies.
export default function DocumentSyncConflicts({ root }: { root: string }) {
  const t = useTranslations('documents');
  const conflicts = useSyncConflictsQuery(root);
  const items = conflicts.data ?? [];
  if (items.length === 0) return null;

  return (
    <div className="mx-2 mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-200">
      <p className="flex items-center gap-1.5 font-medium">
        <TriangleAlert className="size-3.5 shrink-0" />
        {t('syncConflicts', { count: items.length })}
      </p>
      <ul className="mt-1 space-y-0.5 ps-5">
        {items.map((conflict) => (
          <li key={conflict.path}>
            <Link
              href={vaultNotePath(conflict.original)}
              className="block truncate hover:underline"
              dir="auto"
              title={conflict.path}
            >
              {noteName(conflict.original)}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
