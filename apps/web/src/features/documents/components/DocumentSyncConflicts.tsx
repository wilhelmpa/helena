'use client';

import { Box, Notice } from '@/design-system';
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
    <Box padX={2} marginTop={2}>
      <Notice
        tone="warning"
        icon={<TriangleAlert />}
        title={t('syncConflicts', { count: items.length })}
      >
        <ul>
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
      </Notice>
    </Box>
  );
}
