'use client';

import { useTranslations } from 'next-intl';
import { KeyRound, ServerCrash } from 'lucide-react';
import {
  agentActivityPath,
  globalInboxPath,
  globalAgentActivityPath,
  homeChatPath,
  issuePath,
} from '@/utils/paths';
import { useApprovals } from '@/features/approvals/services/approvals.service';
import { usePipelineApprovals } from '@/services/pipelines.service';
import { useProposalCount } from '@/features/agent-runtime/services/agentRuntime.service';
import { KNOWN_PROVIDERS } from '@/features/provider-limits/utils/limitsFormat';
import type { NeedsYouEntry, NeedsYouSource } from '@/extensions/needsYouSources';
import { useHomeActiveActivity } from '../services/homeKpis.service';
import { useSystemHealthQuery } from '../services/systemHealth.service';
import { loginRows } from '../utils/runtimeLogins';
import { openSystemDetails } from './systemDetails';

// The built-in sources of "Braucht dich" (extensions/needsYouSources). Each opens where its
// entry is decided or looked at.

const APPROVALS_SHOWN = 10;

function useApprovalEntries(): { entries: NeedsYouEntry[]; isPending: boolean } {
  const approvals = useApprovals('pending', { page: 1, pageSize: APPROVALS_SHOWN });
  return {
    entries: (approvals.data?.items ?? []).map((a) => ({
      key: `approval:${a.id}`,
      kind: 'approval',
      at: a.createdAt,
      href: globalInboxPath('updates'),
      title: a.action,
      detail: [a.agentName, a.issueIdentifier ?? a.projectName].filter(Boolean).join(' · '),
    })),
    isPending: approvals.isPending,
  };
}

function useStepEntries(): { entries: NeedsYouEntry[]; isPending: boolean } {
  const steps = usePipelineApprovals();
  return {
    entries: (steps.data ?? []).map((step) => ({
      key: `step:${step.runId}:${step.stepId}:${step.iteration}`,
      kind: 'step',
      at: step.waitingSince,
      href: globalInboxPath('updates'),
      title: `${step.pipelineName} · ${step.stepName}`,
      detail: step.issueIdentifier ?? step.projectName,
    })),
    isPending: false,
  };
}

function useProposalEntries(): { entries: NeedsYouEntry[]; isPending: boolean } {
  const t = useTranslations('home.needsYou');
  const count = useProposalCount().data?.count ?? 0;
  return {
    entries:
      count > 0
        ? [
            {
              key: 'proposals',
              kind: 'proposals',
              at: '',
              href: globalInboxPath('updates'),
              title: t('proposals', { count }),
              detail: '',
            },
          ]
        : [],
    isPending: false,
  };
}

// Runs and chat answers that failed, from the recent activity. A failed chat answer opens
// the chat, a run its task (or the project's timeline).
function useFailureEntries(): { entries: NeedsYouEntry[]; isPending: boolean } {
  const t = useTranslations('home.needsYou');
  const tActivity = useTranslations('agentActivity');
  const activity = useHomeActiveActivity();
  return {
    entries: (activity.data?.items ?? [])
      .filter((entry) => entry.status === 'failed')
      .map((entry) => ({
        key: entry.id,
        kind: 'failure',
        projectKey: entry.project?.key ?? null,
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
          (entry.kind === 'chat' ? t('chatFailed') : (entry.project?.name ?? '')),
      })),
    isPending: activity.isPending,
  };
}

// For the Administrator: a service Helena works with that is down, and a model login to sign
// in again (the provider rejected it, or it ran out and nothing renews it). Both open the
// health overview, which names the reason and, for a login, the command to copy. A renewal
// that only fails for now is amber and stays in the System tile.
function useSystemEntries({ owner }: { owner: boolean }): {
  entries: NeedsYouEntry[];
  isPending: boolean;
} {
  const t = useTranslations('home.problems');
  const tHealth = useTranslations('god.systemHealth');
  const tp = useTranslations('providerLimits');
  const health = useSystemHealthQuery(owner);
  if (!owner || !health.data) return { entries: [], isPending: false };
  const services: NeedsYouEntry[] = health.data.services
    .filter((service) => service.state === 'down')
    .map((service) => ({
      key: `problem:service:${service.service}`,
      kind: 'problem',
      at: service.lastSeenAt ?? '',
      onSelect: openSystemDetails,
      icon: ServerCrash,
      title: t('serviceDown', {
        service: tHealth(`service.${service.service}` as 'service.runner'),
      }),
      detail: service.error ?? '',
    }));
  const logins: NeedsYouEntry[] = loginRows(health.data.logins)
    .filter((row) => row.needsOwner)
    .map((row) => ({
      key: `problem:login:${row.key}`,
      kind: 'problem',
      at: row.login.refreshedAt ?? '',
      onSelect: openSystemDetails,
      icon: KeyRound,
      title: t('relogin', {
        provider: KNOWN_PROVIDERS.has(row.login.provider)
          ? tp(`providers.${row.login.provider}` as 'providers.anthropic')
          : row.login.provider,
      }),
      detail: t(row.login.state === 'invalid' ? 'rejected' : 'ranOut'),
    }));
  return { entries: [...services, ...logins], isPending: false };
}

export const BUILTIN_NEEDS_YOU_SOURCES: NeedsYouSource[] = [
  { id: 'system', order: 10, useEntries: useSystemEntries },
  { id: 'approvals', order: 20, useEntries: useApprovalEntries },
  { id: 'workflow-steps', order: 30, useEntries: useStepEntries },
  { id: 'proposals', order: 40, useEntries: useProposalEntries },
  { id: 'failures', order: 50, useEntries: useFailureEntries },
];
