import type { UseQueryResult } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { NoteRevision } from '@/lib/api/endpoints/knowledge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useRelativeTime } from '@/context/relativeTimeContext';
import { cn } from '@/lib/utils';

export default function DocumentHistoryList({
  history,
  selected,
  onSelect,
}: {
  history: UseQueryResult<NoteRevision[]>;
  selected: string | null;
  onSelect: (commit: string) => void;
}) {
  const t = useTranslations('documents');
  const relativeTime = useRelativeTime();

  return (
    <aside className="max-h-[min(72vh,640px)] overflow-y-auto border-b bg-muted/15 p-2 md:border-e md:border-b-0">
      {history.isPending ? (
        <div className="space-y-1.5 p-1" aria-hidden>
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : history.isError ? (
        <div className="grid min-h-48 place-items-center px-4 text-center">
          <div>
            <p className="text-sm text-muted-foreground">{t('historyLoadFailed')}</p>
            <Button
              type="button"
              className="mt-3"
              variant="outline"
              size="sm"
              onClick={() => void history.refetch()}
            >
              <RefreshCw />
              {t('reload')}
            </Button>
          </div>
        </div>
      ) : (
        <ol aria-label={t('versionHistory')}>
          {history.data.map((revision) => (
            <li key={revision.commit}>
              <button
                type="button"
                className={cn(
                  'flex w-full flex-col gap-1 rounded-md px-3 py-2.5 text-start transition-colors outline-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring',
                  selected === revision.commit && 'bg-accent text-accent-foreground',
                )}
                aria-current={selected === revision.commit ? 'true' : undefined}
                onClick={() => onSelect(revision.commit)}
              >
                <span className="truncate text-sm font-medium" dir="auto">
                  {revision.authorName}
                </span>
                <span className="truncate text-xs text-muted-foreground" dir="auto">
                  {revision.message}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {relativeTime(revision.committedAt)}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
