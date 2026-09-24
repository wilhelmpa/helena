'use client';

import { useTranslations } from 'next-intl';
import {
  agentActivityPath,
  approvalsPath,
  globalAgentActivityPath,
  homeChatPath,
  issuePath,
} from '@/utils/paths';
import { useApprovals } from '@/features/approvals/services/approvals.service';
import { usePipelineApprovals } from '@/services/pipelines.service';
import { useProposalCount } from '@/features/agent-runtime/services/agentRuntime.service';
import { useNow } from '@/features/provider-limits/hooks/useNow';
import { useHomeActiveActivity } from '../services/homeKpis.service';
import { splitNeedsYou, type NeedsYouKind, type NeedsYouSource } from './needsYou';

const APPROVALS_SHOWN = 10;

export interface NeedsYouEntry extends NeedsYouSource {
  href: string;
  title: string;
  detail: string;
  // Agent name for an avatar, where there is one.
  agent: string | null;
}

export interface NeedsYouData {
  items: NeedsYouEntry[];
  aged: number;
  hidden: number;
  // Everything that waits on a decision (approvals, steps, proposals), for a figure.
  decisions: number;
  failures: number;
  isPending: boolean;
}

// "Braucht dich" from the approvals, the workflow approval steps, the memory/update
// proposals and the recent activity (its failed runs and chat answers). Every entry opens
// where it is decided or looked at: approvals and steps the approvals page, a failed run
// its task (or the project's timeline), a failed chat answer the chat.
export function useNeedsYou(dismissed: ReadonlySet<string>): NeedsYouData {
  const tActivity = useTranslations('agentActivity');
  const t = useTranslations('home');
  const approvals = useApprovals('pending', { page: 1, pageSize: APPROVALS_SHOWN });
  const steps = usePipelineApprovals();
  const proposals = useProposalCount();
  const activity = useHomeActiveActivity();
  const now = useNow(60_000);

  const sources: NeedsYouEntry[] = [
    ...(approvals.data?.items ?? []).map((a): NeedsYouEntry => ({
      key: `approval:${a.id}`,
      kind: 'approval',
      at: a.createdAt,
      href: approvalsPath(),
      title: a.action,
      detail: [a.agentName, a.issueIdentifier ?? a.projectName].filter(Boolean).join(' · '),
      agent: a.agentName,
    })),
    ...(steps.data ?? []).map((step): NeedsYouEntry => ({
      key: `step:${step.runId}:${step.stepId}:${step.iteration}`,
      kind: 'step',
      at: step.waitingSince,
      href: approvalsPath(),
      title: `${step.pipelineName} · ${step.stepName}`,
      detail: step.issueIdentifier ?? step.projectName,
      agent: null,
    })),
    ...((proposals.data?.count ?? 0) > 0
      ? [
          {
            key: 'proposals',
            kind: 'proposals' as NeedsYouKind,
            at: '',
            href: approvalsPath(),
            title: t('needsYou.proposals', { count: proposals.data!.count }),
            detail: '',
            agent: null,
          },
        ]
      : []),
    ...(activity.data?.items ?? [])
      .filter((entry) => entry.status === 'failed')
      .map((entry): NeedsYouEntry => ({
        key: entry.id,
        kind: 'failure',
        at: entry.at,
        href:
          entry.kind === 'chat' && entry.agent && entry.threadId
            ? homeChatPath({ agent: entry.agent.id, thread: entry.threadId })
            : entry.issue && entry.project
              ? issuePath(entry.project.key, entry.issue.sequenceNumber)
              : entry.project
                ? agentActivityPath(entry.project.key)
                : globalAgentActivityPath(),
        title: entry.agent?.name ?? tActivity(`kinds.${entry.kind}`),
        detail:
          entry.issue?.title ??
          (entry.kind === 'chat' ? t('needsYou.chatFailed') : (entry.project?.name ?? '')),
        agent: entry.agent?.name ?? null,
      })),
  ];

  const split = splitNeedsYou(sources, dismissed, now);
  const decisions =
    (approvals.data?.total ?? 0) + (steps.data?.length ?? 0) + (proposals.data?.count ?? 0);
  return {
    ...split,
    decisions,
    failures: split.items.filter((item) => item.kind === 'failure').length,
    isPending: approvals.isPending || activity.isPending,
  };
}
