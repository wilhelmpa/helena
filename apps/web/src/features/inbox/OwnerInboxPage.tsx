'use client';

import { useState, type MouseEvent, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
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
import { openRun } from '@/features/agent-runtime/runOverlay';
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
import { ProjectTag } from '@/components/helena/ProjectTag';
import { Card, EmptyState, GroupHead, Page, Section, Sections, Stack } from '@/design-system';
import { CheckCircle2, CircleAlert, History } from 'lucide-react';
import InboxWorkspace from './InboxWorkspace';
import OwnerInboxTabs, { type OwnerInboxTab } from './OwnerInboxTabs';
import PillButton from '@/components/helena/PillButton';
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
    <Card as="article" layout="row" gap={4} className={styles.card}>
      <Orb state={status} size="dot" className={styles.dot} />
      <div className={styles.cardContent}>
        <span className={styles.tag} style={{ color: projectColor(item.projectKey) }}>
          {item.projectKey ? <ProjectTag projectKey={project} plain /> : project} · {tag}
        </span>
        <h2>{title}</h2>
        <p>{shortBody}</p>
        <div className={styles.actions}>
          {item.kind === 'approval' ? (
            item.approval.kind === 'budget' ? (
              <PillButton className={styles.primary} onClick={() => setExpanded(true)}>
                {t('decide')}
              </PillButton>
            ) : (
              <PillButton
                className={styles.primary}
                disabled={busy}
                onClick={() =>
                  approvalDecision.mutate({ id: item.approval.id, decision: { approved: true } })
                }
              >
                {t('approve')}
              </PillButton>
            )
          ) : item.kind === 'step' ? (
            <PillButton
              className={styles.primary}
              disabled={busy}
              onClick={() =>
                stepDecision.mutate({ runId: item.step.runId, decision: { approved: true } })
              }
            >
              {t('approve')}
            </PillButton>
          ) : item.kind === 'proposal' ? (
            <PillButton className={styles.primary} onClick={() => setExpanded(true)}>
              {t('decide')}
            </PillButton>
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
              <PillButton
                className={styles.primary}
                onClick={item.entry.onSelect ?? openSystemDetails}
              >
                {t('openDetails')}
              </PillButton>
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
    </Card>
  );
}

const HOME = '__helena';

function OwnerInboxUpdates({ tabs }: { tabs: ReactNode }) {
  const t = useTranslations('inbox.owner');
  const { actions, reads, projects, loading, error } = useOwnerInbox();
  const params = useSearchParams();
  // ?project=KEY (a project's Inbox link) narrows it to that project.
  const filter = params.get('project') ?? 'all';
  const selected =
    filter === 'all' || projects.length === 0 || projects.some((project) => project.key === filter)
      ? filter
      : 'all';
  const visible = actions.filter((item) => selected === 'all' || item.projectKey === selected);
  // Hierarchical by project (owner 28.09.): what is Helena's first, then each project in
  // the sidebar's order.
  const groups = [
    { key: HOME, name: t('home'), items: visible.filter((item) => !item.projectKey) },
    ...projects.map((project) => ({
      key: project.key,
      name: project.name,
      items: visible.filter((item) => item.projectKey === project.key),
    })),
    {
      key: 'other',
      name: t('otherProjects'),
      items: visible.filter(
        (item) => item.projectKey && !projects.some((project) => project.key === item.projectKey),
      ),
    },
  ].filter((group) => group.items.length > 0);
  const visibleReads = reads
    .filter((item) => selected === 'all' || item.project?.key === selected)
    .slice(0, 5);
  return (
    <Page toolbar={tabs}>
      <Sections>
        {visible.length > 0 && (
          <Section
            title={
              <>
                {t('headingCount', { count: visible.length })}{' '}
                {t('needsYou', { count: visible.length })}
              </>
            }
          >
            {groups.map((group) => (
              <section key={group.key} aria-label={group.name}>
                <GroupHead
                  count={group.items.length}
                  icon={group.key !== HOME ? <ProjectTag projectKey={group.key} plain /> : null}
                >
                  {group.name}
                </GroupHead>
                <Stack gap={4}>
                  {group.items.map((item) => (
                    <InboxCard key={item.key} item={item} />
                  ))}
                </Stack>
              </section>
            ))}
          </Section>
        )}
        {error && (
          <EmptyState icon={<CircleAlert />} fill={false}>
            {t('loadError')}
          </EmptyState>
        )}
        {error && visible.length === 0 ? null : loading && actions.length === 0 ? (
          <EmptyState fill={false}>{t('loading')}</EmptyState>
        ) : visible.length === 0 ? (
          <EmptyState icon={<CheckCircle2 />} fill={false}>
            {t('empty')}
          </EmptyState>
        ) : null}
        <Section title={t('toRead')}>
          {visibleReads.length === 0 ? (
            <EmptyState icon={<History />} boxed>
              {t('noCompletedRuns')}
            </EmptyState>
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
                <Card
                  as={Link}
                  key={entry.id}
                  href={href}
                  interactive
                  pad="tight"
                  layout="row"
                  className={styles.readRow}
                  onClick={(event: MouseEvent) => {
                    if (target?.kind !== 'run') return;
                    event.preventDefault();
                    openRun(target.agentId, target.runId);
                  }}
                >
                  <span style={{ color: projectColor(entry.project?.key ?? null) }}>
                    {entry.project?.key.toUpperCase() ?? t('home')}
                  </span>
                  <span>
                    {entry.issue?.title ??
                      t('runCompleted', { name: entry.agent?.name ?? t('anAgent') })}
                  </span>
                  <time dateTime={entry.at}>{formatTime(entry.at)}</time>
                </Card>
              );
            })
          )}
        </Section>
      </Sections>
      <SystemDetailsDialog />
    </Page>
  );
}

function OwnerInboxContent() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { actions } = useOwnerInbox();
  // The mail is first, like in a project; ?tab=updates opens what needs the owner (the
  // tab shows how many are waiting). The tab is in the address, so a link can point at it.
  const tab: OwnerInboxTab = params.get('tab') === 'updates' ? 'updates' : 'messages';
  const change = (next: OwnerInboxTab) => {
    const query = new URLSearchParams(params);
    if (next === 'updates') {
      query.set('tab', 'updates');
      query.delete('thread');
    } else query.delete('tab');
    const search = query.toString();
    router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
  };
  const tabs = <OwnerInboxTabs tab={tab} waiting={actions.length} onChange={change} />;
  // The mail runs edge to edge like the project's (O74/O81).
  return tab === 'messages' ? (
    <Page variant="split">
      <InboxWorkspace projectKey={null} leading={tabs} />
    </Page>
  ) : (
    <OwnerInboxUpdates tabs={tabs} />
  );
}

export default function OwnerInboxPage() {
  const t = useTranslations('inbox.owner');
  return (
    <Shell globalHome globalTitle={t('title')} autoOpenGlobalChat={false}>
      <OwnerInboxContent />
    </Shell>
  );
}
