'use client';

import { useTranslations } from 'next-intl';
import { AlertTriangle, CircleCheck, CircleCheckBig, Workflow } from 'lucide-react';
import {
  agentActivityPath,
  approvalsPath,
  globalAgentActivityPath,
  issuePath,
  workflowRunPath,
} from '@/utils/paths';
import { useApprovals } from '@/features/approvals/services/approvals.service';
import { useWorkflowGates } from '@/services/approvals.service';
import { RowEmpty, RowLink, RowList, SectionLabel } from '@/components/common/page/RowList';
import { useHomeActiveActivity, HOME_ACTIVE_STATUSES } from '../../services/homeKpis.service';

const LIMIT = 5;

type NeedsYouEntry = {
  key: string;
  href: string;
  icon: typeof AlertTriangle;
  tone: 'waiting' | 'danger';
  title: string;
  detail: string;
};

// "Braucht dich" (docs/volition-design-helena-ui.md "Start"): approvals waiting on
// a decision, workflow runs suspended at their approval gate, and runs that failed
// recently — composed from the existing approvals/workflow-gates/activity endpoints,
// capped to a handful so it reads as a short list to act on, not a second inbox.
// Every row opens the place the decision is made: an approval the approvals page, a
// gate its workflow run, a failed run its task or the project's agent timeline.
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
    ...(approvals.data?.items ?? []).map((a): NeedsYouEntry => ({
      key: `approval:${a.id}`,
      href: approvalsPath(),
      icon: CircleCheck,
      tone: 'waiting',
      title: `${a.agentName} · ${a.action}`,
      detail: a.issueIdentifier ? `${a.issueIdentifier} · ${a.projectName}` : a.projectName,
    })),
    ...(gates.data?.items ?? []).map((g): NeedsYouEntry => ({
      key: `gate:${g.projectKey}:${g.workflowId}:${g.runId}`,
      href: workflowRunPath(g.projectKey, g.workflowId, g.runId),
      icon: Workflow,
      tone: 'waiting',
      title: g.workflowName,
      detail: g.summary ?? g.reason ?? g.projectName,
    })),
    ...failed.map((entry): NeedsYouEntry => ({
      key: `run:${entry.id}`,
      href:
        entry.issue && entry.project
          ? issuePath(entry.project.key, entry.issue.sequenceNumber)
          : entry.project
            ? agentActivityPath(entry.project.key)
            : globalAgentActivityPath(),
      icon: AlertTriangle,
      tone: 'danger',
      title: entry.agent?.name ?? tActivity(`kinds.${entry.kind}`),
      detail: [tActivity('status.failed'), entry.issue?.title ?? entry.project?.name]
        .filter(Boolean)
        .join(' · '),
    })),
  ].slice(0, LIMIT);

  return (
    <section className="min-w-0">
      <SectionLabel
        trailing={
          entries.length > 0 ? (
            <span className="font-mono text-xs tabular-nums">{entries.length}</span>
          ) : null
        }
      >
        {t('needsYou')}
      </SectionLabel>
      <RowList>
        {entries.length === 0 ? (
          <RowEmpty icon={<CircleCheckBig className="text-status-success" />}>
            {t('needsYouEmpty')}
          </RowEmpty>
        ) : (
          entries.map((entry) => {
            const Icon = entry.icon;
            return (
              <RowLink
                key={entry.key}
                href={entry.href}
                icon={
                  <Icon
                    className={
                      entry.tone === 'danger' ? 'text-status-danger!' : 'text-status-waiting!'
                    }
                  />
                }
                title={entry.title}
                detail={entry.detail}
              />
            );
          })
        )}
      </RowList>
    </section>
  );
}
