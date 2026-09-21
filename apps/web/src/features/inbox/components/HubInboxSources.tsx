'use client';

import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import type { HubInboxSource } from '@/lib/api/endpoints/hubInbox';
import type { Project } from '@/lib/api/endpoints/projects';
import { useUpdateHubInboxSource } from '../services/hubInbox.service';

export default function HubInboxSources({
  teamId,
  sources,
  projects,
}: {
  teamId: number;
  sources: HubInboxSource[];
  projects: Project[];
}) {
  const t = useTranslations('inbox.hub');
  const update = useUpdateHubInboxSource(teamId);
  const save = (sourceId: number, patch: Parameters<typeof update.mutate>[0]['patch']) =>
    update.mutate(
      { sourceId, patch },
      { onError: (error) => toast.error(error instanceof Error ? error.message : t('saveFailed')) },
    );
  if (sources.length === 0) {
    return <p className="border-b px-4 py-3 text-xs text-muted-foreground">{t('noSources')}</p>;
  }
  return (
    <div className="grid gap-2 border-b bg-muted/20 p-3 lg:grid-cols-2">
      {sources.map((source) => (
        <div key={source.id} className="rounded-md border bg-background p-3 text-xs">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate font-medium">{source.account}</div>
              <div className="text-muted-foreground">
                {t(`channel.${source.channel}`)} · {t(`connection.${source.status}`)}
              </div>
            </div>
            <Switch
              checked={source.enabled}
              disabled={update.isPending}
              aria-label={t('enabled')}
              onCheckedChange={(enabled) => save(source.id, { enabled })}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2">
              {t('confidence')}
              <select
                className="h-7 rounded border bg-background px-1"
                value={source.confidenceThreshold}
                disabled={update.isPending}
                onChange={(event) =>
                  save(source.id, { confidenceThreshold: Number(event.target.value) })
                }
              >
                <option value={0.6}>60%</option>
                <option value={0.75}>75%</option>
                <option value={0.9}>90%</option>
              </select>
            </label>
            <label className="flex items-center gap-2">
              <Switch
                size="sm"
                checked={source.autoCreateTasks}
                disabled={
                  update.isPending || (!source.autoCreateTasks && source.autoTaskProjectId == null)
                }
                onCheckedChange={(autoCreateTasks) => save(source.id, { autoCreateTasks })}
              />
              {t('autoCreate')}
            </label>
            <label className="flex items-center gap-2">
              {t('autoTaskProject')}
              <select
                className="h-7 max-w-56 rounded border bg-background px-1"
                value={source.autoTaskProjectId ?? ''}
                disabled={update.isPending}
                onChange={(event) =>
                  save(source.id, {
                    autoTaskProjectId: event.target.value ? Number(event.target.value) : null,
                  })
                }
              >
                <option value="">{t('reviewOnly')}</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.key} · {project.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {source.lastError ? <p className="mt-2 text-destructive">{source.lastError}</p> : null}
        </div>
      ))}
    </div>
  );
}
