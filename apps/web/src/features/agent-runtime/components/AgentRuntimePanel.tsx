'use client';

import { CodeBlock } from '@/design-system';
import { useId, useState } from 'react';
import {
  CheckCircle2,
  LoaderCircle,
  Pin,
  PinOff,
  RefreshCw,
  Stethoscope,
  TriangleAlert,
  Wand2,
} from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SectionLabel } from '@/components/common/page/RowList';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { PAGE_CONTROL_ACTIVE_CLASS, PAGE_CONTROL_CLASS } from '@/components/layout/PageToolbar';
import { cn } from '@/lib/utils';
import {
  useCuratorStatus,
  useRunCurator,
  usePinSkill,
  useRuntimeHealth,
  useRuntimeLogs,
  useRuntimeVersion,
} from '../services/agentRuntime.service';
import RuntimeError from './RuntimeError';

const LEVELS = [null, 'WARNING', 'ERROR'] as const;

// The agent's runtime as its runner reads it: the version it runs, a health check (Hermes'
// own doctor), its log, and its skill curator: its state, a review now (Helena also asks for
// one every week), and pinning a skill it must leave alone. Whether the curator works at all
// is a setting of the agent (its pause).
export default function AgentRuntimePanel({
  teamId,
  agentId,
  canEdit,
  capabilities,
  learnedSkills,
}: {
  teamId: number;
  agentId: number;
  canEdit: boolean;
  capabilities: string[];
  learnedSkills: string[];
}) {
  const t = useTranslations('agentRuntime.runtime');
  return (
    <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4">
      <VersionRow teamId={teamId} agentId={agentId} />
      {capabilities.includes('health') && <Health teamId={teamId} agentId={agentId} />}
      {capabilities.includes('curator') && (
        <Curator
          teamId={teamId}
          agentId={agentId}
          canEdit={canEdit}
          learnedSkills={learnedSkills}
        />
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
        <CodeBlock>{version.data?.detail ?? version.data?.version ?? '—'}</CodeBlock>
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
          <CodeBlock>{health.data.report}</CodeBlock>
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
  learnedSkills,
}: {
  teamId: number;
  agentId: number;
  canEdit: boolean;
  // The skills the agent learned itself: the ones the curator manages.
  learnedSkills: string[];
}) {
  const t = useTranslations('agentRuntime.runtime');
  const status = useCuratorStatus(teamId, agentId);
  const run = useRunCurator(teamId, agentId);
  const pin = usePinSkill(teamId, agentId);
  const [skill, setSkill] = useState('');
  const listId = useId();
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
        <>
          {status.data?.paused && (
            <p className="text-sm text-muted-foreground">{t('curatorPaused')}</p>
          )}
          <CodeBlock>{status.data?.report}</CodeBlock>
          {canEdit && (
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (skill.trim()) pin.mutate({ skill: skill.trim(), pinned: true });
              }}
            >
              <Input
                className="h-8 w-56"
                value={skill}
                list={`${listId}-skills`}
                placeholder={t('pinSkill')}
                aria-label={t('pinSkill')}
                dir="ltr"
                onChange={(event) => setSkill(event.target.value)}
              />
              <datalist id={`${listId}-skills`}>
                {learnedSkills.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
              <Button
                type="submit"
                variant="outline"
                size="sm"
                disabled={!skill.trim() || pin.isPending}
              >
                <Pin />
                {t('pin')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!skill.trim() || pin.isPending}
                onClick={() => pin.mutate({ skill: skill.trim(), pinned: false })}
              >
                <PinOff />
                {t('unpin')}
              </Button>
              <span className="text-xs text-muted-foreground">{t('pinHint')}</span>
            </form>
          )}
        </>
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
        <CodeBlock>{logs.data.lines.join('\n')}</CodeBlock>
      )}
    </section>
  );
}
