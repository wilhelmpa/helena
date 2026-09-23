'use client';

import { useState } from 'react';
import { Loader2, RefreshCw, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useNoteVersionQuery } from '../services/knowledge.service';

export default function DocumentVersionPreview({
  path,
  commit,
  latest,
  canRestore,
  onRestore,
}: {
  path: string;
  commit: string | null;
  latest: boolean;
  canRestore: boolean;
  onRestore: (content: string) => Promise<void>;
}) {
  const t = useTranslations('documents');
  const version = useNoteVersionQuery(path, commit);
  const [restoring, setRestoring] = useState(false);

  const restore = async (content: string) => {
    setRestoring(true);
    try {
      await onRestore(content);
    } catch {
      // The failed write is toasted by the shared mutation handler.
    } finally {
      setRestoring(false);
    }
  };

  if (commit === null || version.isPending) {
    return (
      <div className="space-y-3 p-6" aria-hidden>
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }
  if (version.isError) {
    return (
      <div className="grid min-h-72 place-items-center px-6 text-center">
        <div>
          <p className="text-sm text-muted-foreground">{t('historyLoadFailed')}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => void version.refetch()}
          >
            <RefreshCw />
            {t('reload')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <section className="flex max-h-[min(72vh,640px)] min-w-0 flex-col">
      {canRestore && !latest && (
        <div className="flex shrink-0 justify-end border-b px-4 py-2">
          <Button
            variant="outline"
            size="sm"
            disabled={restoring}
            onClick={() => void restore(version.data.content)}
          >
            {restoring ? <Loader2 className="animate-spin" /> : <RotateCcw />}
            {t('restoreVersion')}
          </Button>
        </div>
      )}
      <pre
        className="min-h-0 flex-1 overflow-auto p-5 font-mono text-xs leading-5 whitespace-pre-wrap"
        dir="auto"
      >
        {version.data.content}
      </pre>
    </section>
  );
}
