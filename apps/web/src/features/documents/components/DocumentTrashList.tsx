'use client';

import { FileText, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useRelativeTime } from '@/context/relativeTimeContext';
import { useRestoreVaultPath, useVaultTrashQuery } from '../services/knowledge.service';

export default function DocumentTrashList({ root, canEdit }: { root: string; canEdit: boolean }) {
  const t = useTranslations('documents');
  const relativeTime = useRelativeTime();
  const trash = useVaultTrashQuery(root, true);
  const restore = useRestoreVaultPath(root);

  if (trash.isPending) return <Skeleton className="m-1 h-10" />;
  if (trash.isError) {
    return <p className="px-3 py-8 text-center text-sm text-muted-foreground">{t('loadFailed')}</p>;
  }
  if (trash.data.length === 0) {
    return <p className="px-3 py-8 text-center text-sm text-muted-foreground">{t('trashEmpty')}</p>;
  }

  return (
    <ul className="space-y-px">
      {trash.data.map((item) => (
        <li
          key={item.path}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/65"
        >
          <FileText className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px]" dir="auto" title={item.path}>
              {item.path.slice(root.length + 1)}
            </span>
            <span className="block text-[11px] text-muted-foreground">
              {t('trashedAt', { time: relativeTime(item.trashedAt) })}
            </span>
          </span>
          {canEdit && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('restore')}
              title={t('restore')}
              disabled={restore.isPending}
              onClick={() => restore.mutate(item.path)}
            >
              <RotateCcw />
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
