'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AlertTriangle, CircleCheck, Workflow } from 'lucide-react';
import { approvalsPath, issuePath, projectPath } from '@/utils/paths';
import { useApprovals } from '@/features/approvals/services/approvals.service';
import { useWorkflowGates } from '@/services/approvals.service';
import { useHomeActiveActivity, HOME_ACTIVE_STATUSES } from '../../services/homeKpis.service';

const LIMIT = 5;

type NeedsYouEntry = {
  key: string;
  href: string;
  icon: typeof AlertTriangle;
  title: string;
  detail: string;
};

// "Braucht dich" (docs/volition-design-helena-ui.md "Start"): approvals waiting on
// a decision, workflow runs suspended at their approval gate, and runs that
// failed recently — composed from the existing approvals/workflow-gates/activity
// endpoints rather than a new one, capped to a handful so it reads as a short list
// to act on, not a second inbox.
export default function HomeNeedsYou() {
  const t = useTranslations('nav');
  const tActivity = useTranslations('agentActivity');
  const approvals = useApprovals('pending', { page: 1, pageSize: LIMIT });
  const gates = useWorkflowGates();
  const activity = useHomeActiveActivity();

  const failed = (activity.data?.items ?? [])
    .filter((entry) => entry.status === 'failed' && !HOME_ACTIVE_STATUSES.has(entry.status))
    .slice(0, LIMIT);

  const entries: NeedsYouEntry[] = [
    ...(approvals.data?.items ?? []).map(
      (a): NeedsYouEntry => ({
        key: `approval:${a.id}`,
        href: approvalsPath(),
        icon: CircleCheck,
        title: `${a.agentName} · ${a.action}`,
        detail: a.issueIdentifier ? `${a.issueIdentifier} · ${a.projectName}` : a.projectName,
      }),
    ),
    ...(gates.data?.items ?? []).map(
      (g): NeedsYouEntry => ({
        key: `gate:${g.projectKey}:${g.workflowId}:${g.runId}`,
        href: projectPath(g.projectKey),
        icon: Workflow,
        title: g.workflowName,
        detail: g.summary ?? g.reason ?? g.projectName,
      }),
    ),
    ...failed.map(
      (entry): NeedsYouEntry => ({
        key: `run:${entry.id}`,
        href:
          entry.issue && entry.project
            ? issuePath(entry.project.key, entry.issue.sequenceNumber)
            : entry.project
              ? projectPath(entry.project.key)
              : approvalsPath(),
        icon: AlertTriangle,
        title: entry.agent?.name ?? tActivity(`kinds.${entry.kind}`),
        detail: entry.issue?.title ?? entry.project?.name ?? tActivity('status.failed'),
      }),
    ),
  ].slice(0, LIMIT);

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold">{t('needsYou')}</h2>
      {entries.length === 0 ? (
        <div className="rounded-lg border bg-card px-3 py-2 text-sm text-muted-foreground">
          {t('needsYouEmpty')}
        </div>
      ) : (
        <div className="divide-y divide-border rounded-lg border bg-card">
          {entries.map((entry) => {
            const Icon = entry.icon;
            return (
              <Link
                key={entry.key}
                href={entry.href}
                className="flex items-center gap-2.5 px-3 py-2 text-sm transition-colors hover:bg-accent"
              >
                <Icon className="size-4 shrink-0 text-status-waiting" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{entry.title}</div>
                  <div className="truncate text-xs text-muted-foreground">{entry.detail}</div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
