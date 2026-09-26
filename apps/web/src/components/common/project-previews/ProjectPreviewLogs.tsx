'use client';

import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { getProjectPreviewLogs } from '@/lib/api/endpoints/project-previews';

export default function ProjectPreviewLogs({
  projectKey,
  name,
}: {
  projectKey: string;
  name: string;
}) {
  const t = useTranslations('nav.workspace.browserPreviews');
  const query = useQuery({
    queryKey: ['project-preview-logs', projectKey, name],
    queryFn: () => getProjectPreviewLogs(projectKey, name),
  });
  return (
    <div className="min-w-0 space-y-1">
      <Button
        size="sm"
        variant="ghost"
        disabled={query.isFetching}
        onClick={() => void query.refetch()}
      >
        {t('refresh')}
      </Button>
      {query.isError ? (
        <p role="alert" className="text-destructive">
          {query.error.message}
        </p>
      ) : (
        <pre
          dir="ltr"
          className="max-h-60 overflow-auto rounded-md bg-muted p-2 text-xs break-all whitespace-pre-wrap"
        >
          {query.isPending ? t('loading') : query.data?.lines.join('\n') || t('noLogs')}
        </pre>
      )}
    </div>
  );
}
