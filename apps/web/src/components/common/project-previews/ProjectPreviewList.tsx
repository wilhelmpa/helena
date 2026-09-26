'use client';

import { RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { useProjectPreviews } from '@/services/project-previews.service';
import ProjectPreviewForm from './ProjectPreviewForm';
import ProjectPreviewRow from './ProjectPreviewRow';

export default function ProjectPreviewList({
  projectKey,
  onOpen,
}: {
  projectKey: string;
  onOpen: (url: string) => void;
}) {
  const t = useTranslations('nav.workspace.browserPreviews');
  const { query, start, stop } = useProjectPreviews(projectKey);
  const failure = start.data?.preview.status === 'failed' ? start.data : null;
  return (
    <div className="min-w-0 space-y-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{t('idleHint')}</span>
        <Button
          size="sm"
          variant="ghost"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          <RefreshCw />
          {t('refresh')}
        </Button>
      </div>
      {query.isPending && <p role="status">{t('loading')}</p>}
      {query.isError && (
        <p role="alert" className="text-destructive">
          {query.error.message}
        </p>
      )}
      {(start.error || stop.error) && (
        <p role="alert" className="text-destructive">
          {(start.error || stop.error)?.message}
        </p>
      )}
      {query.data && (
        <>
          {query.data.previews.length === 0 && (
            <p className="text-muted-foreground">{t('empty')}</p>
          )}
          <div className="space-y-2">
            {query.data.previews.map((preview) => (
              <ProjectPreviewRow
                key={preview.name}
                projectKey={projectKey}
                preview={preview}
                canManage={query.data.canManage}
                busy={start.isPending || stop.isPending}
                onStart={() =>
                  start.mutate({
                    name: preview.name,
                    cwd: preview.cwd,
                    command: preview.command,
                    idleTimeoutSec: preview.idleTimeoutSec,
                  })
                }
                onStop={() => stop.mutate(preview.name)}
                onOpen={onOpen}
              />
            ))}
          </div>
          {query.data.canManage ? (
            <ProjectPreviewForm
              busy={start.isPending || stop.isPending}
              onStart={(body) => start.mutate(body)}
            />
          ) : (
            <p className="text-xs text-muted-foreground">{t('readOnly')}</p>
          )}
        </>
      )}
      {start.isPending && (
        <p role="status" className="text-muted-foreground">
          {t('waiting')}
        </p>
      )}
      {failure && (
        <div role="alert" className="space-y-2 text-destructive">
          <p>{failure.preview.error || t('failed')}</p>
          {failure.lines?.length ? (
            <pre
              dir="ltr"
              className="max-h-40 overflow-auto rounded-md bg-muted p-2 text-xs break-all whitespace-pre-wrap"
            >
              {failure.lines.join('\n')}
            </pre>
          ) : null}
        </div>
      )}
    </div>
  );
}
