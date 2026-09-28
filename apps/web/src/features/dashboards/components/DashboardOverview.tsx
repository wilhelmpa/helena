'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import type { ProjectDetail } from '@/lib/api/endpoints/projects';
import { listAgentActivity, type AgentActivityEntry } from '@/lib/api/endpoints/agentActivity';
import { listApprovals } from '@/lib/api/endpoints/approvals';
import { usePermissions } from '@/hooks/usePermissions';
import { usePendingApprovalCount } from '@/services/approvals.service';
import { qk } from '@/services/queryKeys';
import { agentActivityForAgentPath, issuePath, projectApprovalsPath } from '@/utils/paths';
import { formatDurationShort } from '@/utils/dates';
import { useAgentStatus } from '@/utils/helenaStatus';
import Orb from '@/components/helena/Orb';
import { Card, MonoLabel, MonoMeta, Tile } from '@/components/helena/DashboardPrimitives';

const OPEN = new Set(['backlog', 'unstarted', 'started']);
const WORKING = new Set(['running', 'streaming']);
const WAITING = new Set(['waiting', 'suspended']);
const APPROVAL_PAGE = { page: 1, pageSize: 3 };

function ActivityRow({ entry, projectKey }: { entry: AgentActivityEntry; projectKey: string }) {
  const status = useAgentStatus(entry.agent!.id, {
    // A finished run shows the quiet orb: colour only while something happens.
    run: WAITING.has(entry.status) ? 'waiting' : WORKING.has(entry.status) ? 'running' : undefined,
  });
  const href = entry.issue
    ? issuePath(projectKey, entry.issue.sequenceNumber)
    : agentActivityForAgentPath(entry.agent!.id, projectKey);
  return (
    <Link
      href={href}
      className="flex min-h-11 items-center gap-3 rounded-xl bg-[var(--dashboard-raised)] px-3 text-xs text-[var(--dashboard-ink)] transition-colors hover:bg-[var(--dashboard-selected)]"
    >
      <Orb state={status} size="small" />
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium">{entry.agent!.name}</span>
        <span className="ms-2 text-[var(--dashboard-muted)]">
          {entry.issue?.title ?? entry.project?.name ?? ''}
        </span>
      </span>
      <MonoMeta className="shrink-0">{formatDurationShort(entry.at)}</MonoMeta>
    </Link>
  );
}

function OverviewCard({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <Card className="flex min-h-48 flex-col gap-3 p-5">
      <div className="flex items-center justify-between">
        <MonoLabel>{label}</MonoLabel>
        <MonoMeta>{count}</MonoMeta>
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </Card>
  );
}

export default function DashboardOverview({
  projectKey,
  project,
}: {
  projectKey: string;
  project: ProjectDetail;
}) {
  const t = useTranslations('dashboards.overview');
  const { can } = usePermissions();
  const mayDecide = can('ai_agents', 'edit');
  const activity = useQuery({
    queryKey: qk.agentActivity(projectKey, { window: 40 }),
    queryFn: () => listAgentActivity(projectKey, {}, null),
    refetchInterval: 15_000,
  });
  const approvalCount = usePendingApprovalCount(projectKey, mayDecide);
  const approvals = useQuery({
    queryKey: qk.approvals('pending', APPROVAL_PAGE, projectKey),
    queryFn: () => listApprovals(APPROVAL_PAGE, 'pending', projectKey),
    enabled: mayDecide,
  });
  const columnById = new Map(project.columns.map((column) => [column.id, column]));
  const issues = project.issues.filter((issue) => !issue.archivedAt);
  const open = issues.filter((issue) => OPEN.has(columnById.get(issue.columnId)?.stateType ?? ''));
  const started = issues.filter((issue) => columnById.get(issue.columnId)?.stateType === 'started');
  const recent = activity.data?.items ?? [];
  const working = recent.filter(
    (entry, index, entries) =>
      entry.agent &&
      WORKING.has(entry.status) &&
      entries.findIndex(
        (candidate) => candidate.agent?.id === entry.agent?.id && WORKING.has(candidate.status),
      ) === index,
  );
  const waiting = recent.filter(
    (entry, index, entries) =>
      entry.agent &&
      WAITING.has(entry.status) &&
      entries.findIndex(
        (candidate) => candidate.agent?.id === entry.agent?.id && WAITING.has(candidate.status),
      ) === index,
  );
  const finished = recent.filter((entry) => entry.agent && entry.status === 'success');
  const pendingAgents = new Set(approvals.data?.items.map((approval) => approval.agentId) ?? []);
  const waitingWithoutApproval = waiting.filter((entry) => !pendingAgents.has(entry.agent!.id));
  const needs = (approvalCount.data?.count ?? 0) + waitingWithoutApproval.length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-[14px]">
        <Tile
          label={t('openTasks')}
          value={open.length}
          note={t('total', { count: issues.length })}
        />
        <Tile label={t('inProgress')} value={started.length} note={t('projectTasks')} />
        <Tile label={t('agentsWorking')} value={working.length} note={t('running')} />
        <Tile
          label={t('needsYou')}
          value={needs}
          note={t('approvalsAndQuestions')}
          tone={needs > 0 ? 'attention' : 'default'}
        />
      </div>
      <div className="grid gap-[14px] xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <OverviewCard label={t('running')} count={working.length}>
          {working.length ? (
            working
              .slice(0, 4)
              .map((entry) => <ActivityRow key={entry.id} entry={entry} projectKey={projectKey} />)
          ) : (
            <p className="py-5 text-xs text-[var(--dashboard-muted)]">{t('noRunning')}</p>
          )}
        </OverviewCard>
        <div className="flex min-w-0 flex-col gap-[14px]">
          <OverviewCard label={t('needsYou')} count={needs}>
            {approvals.data?.items.map((approval) => (
              <Link
                key={approval.id}
                href={projectApprovalsPath(projectKey)}
                className="flex min-h-11 items-center gap-3 rounded-xl bg-[var(--dashboard-raised)] px-3 text-xs text-[var(--dashboard-ink)] hover:bg-[var(--dashboard-selected)]"
              >
                <Orb state="waiting" size="small" />
                <span className="min-w-0 flex-1 truncate">{approval.action}</span>
              </Link>
            ))}
            {waitingWithoutApproval.slice(0, 3).map((entry) => (
              <ActivityRow key={entry.id} entry={entry} projectKey={projectKey} />
            ))}
            {!needs && (
              <p className="py-5 text-xs text-[var(--dashboard-muted)]">{t('nothingWaiting')}</p>
            )}
          </OverviewCard>
          <OverviewCard label={t('finished')} count={finished.length}>
            {finished.length ? (
              finished
                .slice(0, 4)
                .map((entry) => (
                  <ActivityRow key={entry.id} entry={entry} projectKey={projectKey} />
                ))
            ) : (
              <p className="py-5 text-xs text-[var(--dashboard-muted)]">{t('noFinished')}</p>
            )}
          </OverviewCard>
        </div>
      </div>
    </div>
  );
}
