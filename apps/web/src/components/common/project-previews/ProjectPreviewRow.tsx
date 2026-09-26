'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { FileText, Play, Square, AppWindow } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { getProjectPreviewUrl, type ProjectPreview } from '@/lib/api/endpoints/project-previews';
import ProjectPreviewLogs from './ProjectPreviewLogs';

export default function ProjectPreviewRow({
  projectKey,
  preview,
  canManage,
  busy,
  onStart,
  onStop,
  onOpen,
}: {
  projectKey: string;
  preview: ProjectPreview;
  canManage: boolean;
  busy: boolean;
  onStart: () => void;
  onStop: () => void;
  onOpen: (url: string) => void;
}) {
  const t = useTranslations('nav.workspace.browserPreviews');
  const [logs, setLogs] = useState(false);
  const open = useMutation({
    mutationFn: () => getProjectPreviewUrl(projectKey, preview.name),
    onSuccess: ({ url }) => onOpen(url),
  });
  const running = preview.status === 'running' || preview.status === 'starting';
  return (
    <section className="min-w-0 space-y-2 rounded-md border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="min-w-0 font-medium break-all">{preview.name}</strong>
        <span className="text-xs text-muted-foreground" role="status">
          {t(preview.status)}
        </span>
      </div>
      <p dir="ltr" className="text-xs break-all text-muted-foreground">
        {preview.cwd || '.'} · {preview.command}
      </p>
      {preview.error && (
        <p role="alert" className="text-xs break-words text-destructive">
          {preview.error}
        </p>
      )}
      {open.error && (
        <p role="alert" className="text-xs break-words text-destructive">
          {open.error.message}
        </p>
      )}
      <div className="flex flex-wrap gap-1">
        {preview.status === 'running' && (
          <Button
            size="sm"
            variant="outline"
            disabled={open.isPending}
            onClick={() => open.mutate()}
          >
            <AppWindow />
            {t('open')}
          </Button>
        )}
        {canManage && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={running ? onStop : onStart}>
            {running ? <Square /> : <Play />}
            {t(running ? 'stop' : 'start')}
          </Button>
        )}
        <Button size="sm" variant="ghost" aria-expanded={logs} onClick={() => setLogs(!logs)}>
          <FileText />
          {t('logs')}
        </Button>
      </div>
      {logs && <ProjectPreviewLogs projectKey={projectKey} name={preview.name} />}
    </section>
  );
}
