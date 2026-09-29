'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useFormatter, useTranslations } from 'next-intl';
import { getAgentUsage } from '@/lib/api/endpoints/agentRuntime';
import { useIssueClaimQuery, useIssueWhyQuery } from '@/services/issues.service';
import { formatDurationShort } from '@/utils/dates';
import AgentAvatar from '@/components/common/page/AgentAvatar';
import { compactTokens } from '@/utils/agentUsage';
import { initiativesPath } from '@/utils/paths';
import IssuePropertyRow from './IssuePropertyRow';

// "Warum" (hub/pc-goal-ladder): the goal the task serves, as its ladder — the goal's
// path, then the initiative and the parent tasks in between — so it reads why the task
// exists. Nothing when no goal is reached.
export function IssueWhyRow({ issueId, projectKey }: { issueId: number; projectKey: string }) {
  const t = useTranslations('issue.fields');
  const why = useIssueWhyQuery(issueId).data;
  if (!why?.goal) return null;
  const steps = [
    ...why.goal.path,
    why.goal.title,
    ...(why.initiative ? [why.initiative.title] : []),
    ...why.parents.map((parent) => parent.identifier),
  ];
  return (
    <IssuePropertyRow label={t('why')}>
      <Link href={initiativesPath(projectKey)} className="ds-why" title={steps.join(' › ')}>
        {steps.map((step, index) => (
          <span key={`${index}:${step}`}>
            {index > 0 && <span className="ds-why-sep">›</span>}
            {step}
          </span>
        ))}
      </Link>
    </IssuePropertyRow>
  );
}

// "Bearbeitet von …" (owner, 28.09.: the task lease of Paperclip, shown where it matters):
// the agent whose run holds the task right now, since when. Nothing while nobody does.
export function IssueClaimRow({ issueId }: { issueId: number }) {
  const t = useTranslations('issue.fields');
  const claim = useIssueClaimQuery(issueId).data;
  if (!claim) return null;
  return (
    <IssuePropertyRow label={t('claimedBy')}>
      <span className="ds-issue-claim" title={t('claimedHint')}>
        <AgentAvatar name={claim.agent.name} className="size-5" />
        <span>{claim.agent.name}</span>
        <span className="ds-issue-claim-since">
          {t('claimedSince', { age: formatDurationShort(claim.since) })}
        </span>
      </span>
    </IssuePropertyRow>
  );
}

const DAY_MS = 86_400_000;

// What the agents spent on the task (hub/pc-costs): the euro and tokens of its runs and
// chat answers over the last 400 days, from the team's usage grouped by task. One query
// per project, shared by every task of it.
export function IssueCostRow({
  issueId,
  teamId,
  projectId,
}: {
  issueId: number;
  teamId: number;
  projectId: number;
}) {
  const t = useTranslations('issue.fields');
  const format = useFormatter();
  const [from] = useState(() =>
    new Date(Math.floor(Date.now() / DAY_MS) * DAY_MS - 399 * DAY_MS).toISOString().slice(0, 10),
  );
  const usage = useQuery({
    queryKey: ['agent-usage', teamId, projectId, 'issue', from],
    queryFn: () => getAgentUsage(teamId, { from, projectId, by: ['issue'] }),
    staleTime: 60_000,
  });
  const row = usage.data?.rows.find((item) => item.issueId === issueId);
  if (!row) return null;
  const tokens = row.inputTokens + row.outputTokens;
  return (
    <IssuePropertyRow label={t('cost')}>
      <span className="ds-issue-cost">
        {row.costEur != null
          ? format.number(row.costEur, { style: 'currency', currency: 'EUR' })
          : t('costUnpriced')}
        <span> · {t('costTokens', { tokens: compactTokens(tokens) })}</span>
      </span>
    </IssuePropertyRow>
  );
}
