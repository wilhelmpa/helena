'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import Shell from '@/components/layout/Shell';
import { useOwnerInbox } from './useOwnerInbox';
import type { OwnerInboxItem } from './ownerInboxItems';
import { useDecideApproval } from '@/features/approvals/services/approvals.service';
import { useDecidePipelineApproval } from '@/services/pipelines.service';
import { useSetNotificationRead } from './services/notifications.service';
import ApprovalRequestCard from '@/features/approvals/components/ApprovalRequestCard';
import PipelineApprovalCard from '@/features/approvals/components/PipelineApprovalCard';
import ProposalCard from '@/features/agent-runtime/components/ProposalCard';
import SystemDetailsDialog from '@/features/home/dashboard/SystemDetailsDialog';
import { openSystemDetails } from '@/features/home/dashboard/systemDetails';
import { activityDetails } from '@/features/agent-activity/utils/activityDetails';
import {
  agentActivityPath,
  globalAgentActivityPath,
  homeChatPath,
  issueIdentifierPath,
  issuePath,
} from '@/utils/paths';
import { formatTime } from '@/utils/dates';
import { projectColor } from '@/utils/projectColor';
import Orb from '@/components/helena/Orb';
import { useAgentStatus } from '@/utils/helenaStatus';
import styles from './OwnerInboxPage.module.css';

function InboxCard({ item }: { item: OwnerInboxItem }) {
  const t = useTranslations('inbox.owner');
  const [expanded, setExpanded] = useState(false);
  const approvalDecision = useDecideApproval();
  const stepDecision = useDecidePipelineApproval();
  const mentionRead = useSetNotificationRead(item.projectKey ?? '');
  const isError = item.kind === 'problem' || item.kind === 'failure';
  const agentId =
    item.kind === 'approval'
      ? item.approval.agentId
      : item.kind === 'proposal'
        ? (item.proposal.agentId ?? 0)
        : 0;
  const status = useAgentStatus(agentId, {
    run: isError ? 'failed' : item.kind === 'mention' ? 'idle' : 'waiting',
  });
  const project = item.projectKey?.toUpperCase() ?? t('home');
  const tag =
    item.kind === 'approval'
      ? item.approval.kind === 'budget'
        ? t('tags.budget')
        : t('tags.approval')
      : item.kind === 'step'
        ? t('tags.workflow')
        : item.kind === 'proposal'
          ? t('tags.proposal')
          : item.kind === 'mention'
            ? t('tags.mention')
            : item.kind === 'problem'
              ? t('tags.system')
              : t('tags.failure');
  const title =
    item.kind === 'approval'
      ? item.approval.action
      : item.kind === 'step'
        ? `${item.step.pipelineName} · ${item.step.stepName}`
        : item.kind === 'proposal'
          ? item.proposal.title
          : item.kind === 'mention'
            ? t('mentionedBy', { name: item.notification.actorName ?? t('anAgent') })
            : item.entry.title;
  const body =
    item.kind === 'approval'
      ? item.approval.details || t('approvalRequest', { name: item.approval.agentName })
      : item.kind === 'step'
        ? item.step.message || t('workflowWaiting')
        : item.kind === 'proposal'
          ? t('proposalRequest', { name: item.proposal.agentName ?? t('defaultAgent') })
          : item.kind === 'mention'
            ? item.notification.issueTitle
            : item.entry.detail;
  const shortBody = body.length > 180 ? `${body.slice(0, 177).trimEnd()}…` : body;
  const seeHref =
    item.kind === 'approval' && item.approval.issueSequenceNumber != null
      ? issuePath(item.projectKey, item.approval.issueSequenceNumber)
      : item.kind === 'step' && item.step.issueIdentifier
        ? issueIdentifierPath(item.step.issueIdentifier)
        : item.kind === 'mention'
          ? issuePath(item.projectKey, item.notification.issueSeq)
          : item.kind === 'failure'
            ? (item.entry.href ?? globalAgentActivityPath())
            : null;
  const busy = approvalDecision.isPending || stepDecision.isPending || mentionRead.isPending;

  return (
    <article className={styles.card}>
      <Orb state={status} size="dot" className={styles.dot} />
      <div className={styles.cardContent}>
        <span className={styles.tag} style={{ color: projectColor(item.projectKey) }}>
          {project} · {tag}
        </span>
        <h2>{title}</h2>
        <p>{shortBody}</p>
        <div className={styles.actions}>
          {item.kind === 'approval' ? (
            item.approval.kind === 'budget' ? (
              <button className={styles.primary} onClick={() => setExpanded(true)}>
                {t('decide')}
              </button>
            ) : (
              <button
                className={styles.primary}
                disabled={busy}
                onClick={() =>
                  approvalDecision.mutate({ id: item.approval.id, decision: { approved: true } })
                }
              >
                {t('approve')}
              </button>
            )
          ) : item.kind === 'step' ? (
            <button
              className={styles.primary}
              disabled={busy}
              onClick={() =>
                stepDecision.mutate({ runId: item.step.runId, decision: { approved: true } })
              }
            >
              {t('approve')}
            </button>
          ) : item.kind === 'proposal' ? (
            <button className={styles.primary} onClick={() => setExpanded(true)}>
              {t('decide')}
            </button>
          ) : item.kind === 'mention' ? (
            <Link className={styles.primary} href={seeHref!}>
              {t('reply')}
            </Link>
          ) : item.kind === 'problem' ? (
            item.entry.href ? (
              <Link className={styles.primary} href={item.entry.href}>
                {t('openDetails')}
              </Link>
            ) : (
              <button className={styles.primary} onClick={item.entry.onSelect ?? openSystemDetails}>
                {t('openDetails')}
              </button>
            )
          ) : (
            <Link className={styles.primary} href={seeHref!}>
              {t('viewFailure')}
            </Link>
          )}
          {item.kind === 'mention' ? (
            <button
              className={styles.secondary}
              disabled={busy}
              onClick={() => mentionRead.mutate({ id: item.notification.id, read: true })}
            >
              {t('markRead')}
            </button>
          ) : item.kind === 'problem' ? (
            <Link className={styles.secondary} href="/">
              {t('dashboard')}
            </Link>
          ) : item.kind === 'failure' ? (
            <Link
              className={styles.secondary}
              href={
                item.projectKey ? agentActivityPath(item.projectKey) : globalAgentActivityPath()
              }
            >
              {t('history')}
            </Link>
          ) : item.kind === 'approval' || item.kind === 'step' || item.kind === 'proposal' ? (
            <button className={styles.secondary} onClick={() => setExpanded(!expanded)}>
              {t('view')}
            </button>
          ) : seeHref ? (
            <Link className={styles.secondary} href={seeHref}>
              {t('view')}
            </Link>
          ) : (
            <button className={styles.secondary} onClick={() => setExpanded(!expanded)}>
              {t('view')}
            </button>
          )}
        </div>
        {expanded && (
          <div className={styles.detail}>
            {item.kind === 'approval' ? (
              <ApprovalRequestCard request={item.approval} />
            ) : item.kind === 'step' ? (
              <PipelineApprovalCard approval={item.step} />
            ) : item.kind === 'proposal' ? (
              <ProposalCard proposal={item.proposal} />
            ) : null}
          </div>
        )}
      </div>
      <time className={styles.time} dateTime={item.at || undefined}>
        {item.at ? formatTime(item.at) : t('now')}
      </time>
    </article>
  );
}

function OwnerInboxContent() {
  const t = useTranslations('inbox.owner');
  const { actions, reads, projects, loading, error } = useOwnerInbox();
  const params = useSearchParams();
  const [filter, setFilter] = useState<string>(() => params.get('project') ?? 'all');
  const selected =
    filter === 'all' || projects.length === 0 || projects.some((project) => project.key === filter)
      ? filter
      : 'all';
  const visible = actions.filter((item) => selected === 'all' || item.projectKey === selected);
  const visibleReads = reads
    .filter((item) => selected === 'all' || item.project?.key === selected)
    .slice(0, 5);
  return (
    <main className={styles.main}>
      <div className={styles.content}>
        <p className={styles.eyebrow}>{t('eyebrow')}</p>
        <div className={styles.headingRow}>
          <h1>
            {error && visible.length === 0 ? (
              t('title')
            ) : loading && visible.length === 0 ? (
              t('loadingTitle')
            ) : visible.length === 0 ? (
              t('allDone')
            ) : (
              <>
                {t('headingCount', { count: visible.length })}
                <br />
                {t('needsYou', { count: visible.length })}
              </>
            )}
          </h1>
          <div className={styles.segments} role="group" aria-label={t('project')}>
            <button aria-pressed={selected === 'all'} onClick={() => setFilter('all')}>
              {t('all')}
            </button>
            {projects.map((project) => (
              <button
                key={project.key}
                aria-pressed={selected === project.key}
                onClick={() => setFilter(project.key)}
              >
                {project.name}
              </button>
            ))}
          </div>
        </div>
        {error && <p className={styles.empty}>{t('loadError')}</p>}
        {error && visible.length === 0 ? null : loading && actions.length === 0 ? (
          <p className={styles.empty}>{t('loading')}</p>
        ) : visible.length === 0 ? (
          <p className={styles.empty}>{t('empty')}</p>
        ) : (
          visible.map((item) => <InboxCard key={item.key} item={item} />)
        )}
        <section className={styles.reads} aria-labelledby="reads-heading">
          <h2 id="reads-heading">{t('toRead')}</h2>
          {visibleReads.length === 0 ? (
            <p className={styles.empty}>{t('noCompletedRuns')}</p>
          ) : (
            visibleReads.map((entry) => {
              const target = activityDetails(entry);
              const href =
                target?.kind === 'page'
                  ? target.href
                  : target?.kind === 'chat'
                    ? homeChatPath({ agent: target.agentId, thread: target.threadId })
                    : entry.project
                      ? agentActivityPath(entry.project.key)
                      : globalAgentActivityPath();
              return (
                <Link key={entry.id} href={href} className={styles.readRow}>
                  <span style={{ color: projectColor(entry.project?.key ?? null) }}>
                    {entry.project?.key.toUpperCase() ?? t('home')}
                  </span>
                  <span>
                    {entry.issue?.title ??
                      t('runCompleted', { name: entry.agent?.name ?? t('anAgent') })}
                  </span>
                  <time dateTime={entry.at}>{formatTime(entry.at)}</time>
                </Link>
              );
            })
          )}
        </section>
      </div>
      <SystemDetailsDialog />
    </main>
  );
}

export default function OwnerInboxPage() {
  const t = useTranslations('inbox.owner');
  return (
    <Shell globalHome globalTitle={t('title')} autoOpenGlobalChat={false} mobileHeaderOnly>
      <OwnerInboxContent />
    </Shell>
  );
}
