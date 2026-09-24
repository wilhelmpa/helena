'use client';

import { useState } from 'react';
import {
  CheckCircle2,
  LoaderCircle,
  RefreshCw,
  Stethoscope,
  TriangleAlert,
  Wand2,
} from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { SectionLabel } from '@/components/common/page/RowList';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { PAGE_CONTROL_ACTIVE_CLASS, PAGE_CONTROL_CLASS } from '@/components/layout/PageToolbar';
import { cn } from '@/lib/utils';
import {
  useCuratorStatus,
  useRunCurator,
  useRuntimeHealth,
  useRuntimeLogs,
  useRuntimeVersion,
} from '../services/agentRuntime.service';
import RuntimeError from './RuntimeError';

const LEVELS = [null, 'WARNING', 'ERROR'] as const;

// The agent's runtime as its runner reads it: the version it runs, a health check (Hermes'
// own doctor), its log, and its skill curator. The curator's pause is a setting of the agent.
export default function AgentRuntimePanel({
  teamId,
  agentId,
  canEdit,
  capabilities,
}: {
  teamId: number;
  agentId: number;
  canEdit: boolean;
  capabilities: string[];
}) {
  const t = useTranslations('agentRuntime.runtime');
  return (
    <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4">
      <VersionRow teamId={teamId} agentId={agentId} />
      {capabilities.includes('health') && <Health teamId={teamId} agentId={agentId} />}
      {capabilities.includes('curator') && (
        <Curator teamId={teamId} agentId={agentId} canEdit={canEdit} />
      )}
      {capabilities.includes('logs') ? (
        <Logs teamId={teamId} agentId={agentId} />
      ) : (
        <p className="text-sm text-muted-foreground">{t('noLogs')}</p>
      )}
    </div>
  );
}

function VersionRow({ teamId, agentId }: { teamId: number; agentId: number }) {
  const t = useTranslations('agentRuntime.runtime');
  const version = useRuntimeVersion(teamId, agentId);
  return (
    <section className="space-y-2">
      <SectionLabel>{t('version')}</SectionLabel>
      {version.isPending ? (
        <ListSkeleton rows={1} rowClassName="h-8" />
      ) : version.error ? (
        <RuntimeError error={version.error} />
      ) : (
        <p className="rounded-md bg-card px-3 py-2 font-mono text-xs" dir="ltr">
          {version.data?.detail ?? version.data?.version ?? '—'}
        </p>
      )}
    </section>
  );
}

function Health({ teamId, agentId }: { teamId: number; agentId: number }) {
  const t = useTranslations('agentRuntime.runtime');
  const format = useFormatter();
  const [asked, setAsked] = useState(false);
  const health = useRuntimeHealth(teamId, agentId, asked);
  return (
    <section className="space-y-2">
      <SectionLabel
        trailing={
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5"
            disabled={health.isFetching}
            onClick={() => (asked ? void health.refetch() : setAsked(true))}
          >
            {health.isFetching ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <Stethoscope className="size-3.5" />
            )}
            {t('check')}
          </Button>
        }
      >
        {t('health')}
      </SectionLabel>
      {health.error ? (
        <RuntimeError error={health.error} />
      ) : health.data ? (
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-sm">
            {health.data.ok ? (
              <CheckCircle2 className="size-4 text-status-success" />
            ) : (
              <TriangleAlert className="size-4 text-status-danger" />
            )}
            {health.data.ok ? t('healthy') : t('problems')}
            <span className="text-xs text-muted-foreground">
              {format.relativeTime(new Date(health.data.checkedAt))}
            </span>
          </p>
          <pre
            dir="ltr"
            className="max-h-96 overflow-auto rounded-md bg-card p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap"
          >
            {health.data.report}
          </pre>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t('healthHint')}</p>
      )}
    </section>
  );
}

function Curator({
  teamId,
  agentId,
  canEdit,
}: {
  teamId: number;
  agentId: number;
  canEdit: boolean;
}) {
  const t = useTranslations('agentRuntime.runtime');
  const status = useCuratorStatus(teamId, agentId);
  const run = useRunCurator(teamId, agentId);
  return (
    <section className="space-y-2">
      <SectionLabel
        trailing={
          canEdit ? (
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5"
              disabled={run.running || run.start.isPending}
              onClick={() => run.start.mutate()}
            >
              {run.running ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <Wand2 className="size-3.5" />
              )}
              {t('curatorRun')}
            </Button>
          ) : null
        }
      >
        {t('curator')}
      </SectionLabel>
      {status.isPending ? (
        <ListSkeleton rows={2} rowClassName="h-6" />
      ) : status.error ? (
        <RuntimeError error={status.error} />
      ) : (
        <pre
          dir="ltr"
          className="overflow-auto rounded-md bg-card p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap"
        >
          {status.data?.report}
        </pre>
      )}
    </section>
  );
}

function Logs({ teamId, agentId }: { teamId: number; agentId: number }) {
  const t = useTranslations('agentRuntime.runtime');
  const [level, setLevel] = useState<(typeof LEVELS)[number]>(null);
  const logs = useRuntimeLogs(teamId, agentId, { lines: 300, level });
  return (
    <section className="space-y-2">
      <SectionLabel
        trailing={
          <span className="flex items-center gap-0.5">
            {LEVELS.map((value) => (
              <button
                key={value ?? 'all'}
                type="button"
                aria-pressed={level === value}
                onClick={() => setLevel(value)}
                className={cn(
                  PAGE_CONTROL_CLASS,
                  'h-7',
                  level === value && PAGE_CONTROL_ACTIVE_CLASS,
                )}
              >
                {t(`level.${value ?? 'all'}`)}
              </button>
            ))}
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={t('reload')}
              onClick={() => void logs.refetch()}
            >
              <RefreshCw className={cn('size-3.5', logs.isFetching && 'animate-spin')} />
            </Button>
          </span>
        }
      >
        {t('log')}
      </SectionLabel>
      {logs.isPending ? (
        <ListSkeleton rows={4} rowClassName="h-5" />
      ) : logs.error ? (
        <RuntimeError error={logs.error} />
      ) : !logs.data?.lines.length ? (
        <p className="text-sm text-muted-foreground">{t('logEmpty')}</p>
      ) : (
        <pre
          dir="ltr"
          className="max-h-[32rem] overflow-auto rounded-md bg-card p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap"
        >
          {logs.data.lines.join('\n')}
        </pre>
      )}
    </section>
  );
}
