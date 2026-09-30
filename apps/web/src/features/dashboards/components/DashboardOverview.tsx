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
import {
  agentActivityForAgentPath,
  inboxPath,
  issuePath,
  projectApprovalsPath,
} from '@/utils/paths';
import { runningActivityHref } from '@/features/agent-activity/utils/runningLink';
import { formatDurationShort } from '@/utils/dates';
import { useAgentStatus } from '@/utils/helenaStatus';
import Orb from '@/components/helena/Orb';
import { Card, MonoMeta, Tile } from '@/components/helena/DashboardPrimitives';
import { Grid, Stack, Text } from '@/design-system';

const OPEN = new Set(['backlog', 'unstarted', 'started']);
const WORKING = new Set(['running', 'streaming']);
const WAITING = new Set(['waiting', 'suspended']);
const APPROVAL_PAGE = { page: 1, pageSize: 3 };

// A row of a dashboard card that opens something: an inset (a box in the box), 44px high.
function InsetRow({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Card
      as={Link}
      href={href}
      tone="inset"
      interactive
      pad="tight"
      layout="row"
      className="min-h-11 items-center text-xs"
    >
      {children}
    </Card>
  );
}

function ActivityRow({ entry, projectKey }: { entry: AgentActivityEntry; projectKey: string }) {
  const status = useAgentStatus(entry.agent!.id, {
    // A finished run shows the quiet orb: colour only while something happens.
    run: WAITING.has(entry.status) ? 'waiting' : WORKING.has(entry.status) ? 'running' : undefined,
  });
  const href = entry.issue
    ? issuePath(projectKey, entry.issue.sequenceNumber)
    : agentActivityForAgentPath(entry.agent!.id, projectKey);
  return (
    <InsetRow href={href}>
      <Orb state={status} size="small" />
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium">{entry.agent!.name}</span>
        <span className="ms-2 text-[var(--dashboard-muted)]">
          {entry.issue?.title ?? entry.project?.name ?? ''}
        </span>
      </span>
      <MonoMeta className="shrink-0">{formatDurationShort(entry.at)}</MonoMeta>
    </InsetRow>
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
    <Card eyebrow={label} actions={<MonoMeta>{count}</MonoMeta>} className="min-h-48">
      <Stack gap={2}>{children}</Stack>
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
    <Stack gap={4}>
      <Grid min="fit">
        <Tile
          label={t('openTasks')}
          value={open.length}
          note={t('total', { count: issues.length })}
        />
        <Tile label={t('inProgress')} value={started.length} note={t('projectTasks')} />
        <Tile
          label={t('agentsWorking')}
          value={working.length}
          note={t('running')}
          href={runningActivityHref(working, projectKey)}
        />
        <Tile
          href={inboxPath(projectKey)}
          label={t('needsYou')}
          value={needs}
          note={t('approvalsAndQuestions')}
          tone={needs > 0 ? 'attention' : 'default'}
        />
      </Grid>
      <Grid split>
        <OverviewCard label={t('running')} count={working.length}>
          {working.length ? (
            working
              .slice(0, 4)
              .map((entry) => <ActivityRow key={entry.id} entry={entry} projectKey={projectKey} />)
          ) : (
            <Text as="p" size="xs" tone="muted" className="py-5">
              {t('noRunning')}
            </Text>
          )}
        </OverviewCard>
        <Stack gap={4}>
          <OverviewCard label={t('needsYou')} count={needs}>
            {approvals.data?.items.map((approval) => (
              <InsetRow key={approval.id} href={projectApprovalsPath(projectKey)}>
                <Orb state="waiting" size="small" />
                <span className="min-w-0 flex-1 truncate">{approval.action}</span>
              </InsetRow>
            ))}
            {waitingWithoutApproval.slice(0, 3).map((entry) => (
              <ActivityRow key={entry.id} entry={entry} projectKey={projectKey} />
            ))}
            {!needs && (
              <Text as="p" size="xs" tone="muted" className="py-5">
                {t('nothingWaiting')}
              </Text>
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
              <Text as="p" size="xs" tone="muted" className="py-5">
                {t('noFinished')}
              </Text>
            )}
          </OverviewCard>
        </Stack>
      </Grid>
    </Stack>
  );
}
