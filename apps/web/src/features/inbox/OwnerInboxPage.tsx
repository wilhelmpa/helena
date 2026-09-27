'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
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
import styles from './OwnerInboxPage.module.css';

function InboxCard({ item }: { item: OwnerInboxItem }) {
  const [expanded, setExpanded] = useState(false);
  const approvalDecision = useDecideApproval();
  const stepDecision = useDecidePipelineApproval();
  const mentionRead = useSetNotificationRead(item.projectKey ?? '');
  const isError = item.kind === 'problem' || item.kind === 'failure';
  const project = item.projectKey?.toUpperCase() ?? 'HOME';
  const tag =
    item.kind === 'approval'
      ? item.approval.kind === 'budget'
        ? 'BUDGET'
        : 'FREIGABE'
      : item.kind === 'step'
        ? 'WORKFLOW'
        : item.kind === 'proposal'
          ? 'VORSCHLAG'
          : item.kind === 'mention'
            ? 'ERWÄHNUNG'
            : item.kind === 'problem'
              ? 'SYSTEM'
              : 'FEHLER';
  const title =
    item.kind === 'approval'
      ? item.approval.action
      : item.kind === 'step'
        ? `${item.step.pipelineName} · ${item.step.stepName}`
        : item.kind === 'proposal'
          ? item.proposal.title
          : item.kind === 'mention'
            ? `${item.notification.actorName ?? 'Ein Agent'} hat dich erwähnt`
            : item.entry.title;
  const body =
    item.kind === 'approval'
      ? item.approval.details || `${item.approval.agentName} bittet um eine Entscheidung.`
      : item.kind === 'step'
        ? item.step.message || 'Dieser Workflow wartet auf deine Entscheidung.'
        : item.kind === 'proposal'
          ? `${item.proposal.agentName ?? 'Helena'} schlägt eine Änderung vor.`
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
      <span className={`${styles.dot} ${isError ? styles.danger : ''}`} aria-hidden />
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
                Entscheiden
              </button>
            ) : (
              <button
                className={styles.primary}
                disabled={busy}
                onClick={() =>
                  approvalDecision.mutate({ id: item.approval.id, decision: { approved: true } })
                }
              >
                Freigeben
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
              Freigeben
            </button>
          ) : item.kind === 'proposal' ? (
            <button className={styles.primary} onClick={() => setExpanded(true)}>
              Entscheiden
            </button>
          ) : item.kind === 'mention' ? (
            <Link className={styles.primary} href={seeHref!}>
              Antworten
            </Link>
          ) : item.kind === 'problem' ? (
            item.entry.href ? (
              <Link className={styles.primary} href={item.entry.href}>
                Details öffnen
              </Link>
            ) : (
              <button className={styles.primary} onClick={item.entry.onSelect ?? openSystemDetails}>
                Details öffnen
              </button>
            )
          ) : (
            <Link className={styles.primary} href={seeHref!}>
              Fehler ansehen
            </Link>
          )}
          {item.kind === 'mention' ? (
            <button
              className={styles.secondary}
              disabled={busy}
              onClick={() => mentionRead.mutate({ id: item.notification.id, read: true })}
            >
              Als gelesen
            </button>
          ) : item.kind === 'problem' ? (
            <Link className={styles.secondary} href="/">
              Dashboard
            </Link>
          ) : item.kind === 'failure' ? (
            <Link
              className={styles.secondary}
              href={
                item.projectKey ? agentActivityPath(item.projectKey) : globalAgentActivityPath()
              }
            >
              Verlauf
            </Link>
          ) : item.kind === 'approval' || item.kind === 'step' || item.kind === 'proposal' ? (
            <button className={styles.secondary} onClick={() => setExpanded(!expanded)}>
              Ansehen
            </button>
          ) : seeHref ? (
            <Link className={styles.secondary} href={seeHref}>
              Ansehen
            </Link>
          ) : (
            <button className={styles.secondary} onClick={() => setExpanded(!expanded)}>
              Ansehen
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
        {item.at ? formatTime(item.at) : 'Jetzt'}
      </time>
    </article>
  );
}

function OwnerInboxContent() {
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
        <p className={styles.eyebrow}>DU · INBOX</p>
        <div className={styles.headingRow}>
          <h1>
            {error && visible.length === 0 ? (
              'Inbox'
            ) : loading && visible.length === 0 ? (
              'Inbox wird geladen.'
            ) : visible.length === 0 ? (
              'Alles erledigt.'
            ) : (
              <>
                {visible.length === 1 ? 'Ein' : visible.length === 2 ? 'Zwei' : visible.length}{' '}
                {visible.length === 1 ? 'Ding' : 'Dinge'}
                <br />
                {visible.length === 1 ? 'braucht' : 'brauchen'} dich.
              </>
            )}
          </h1>
          <div className={styles.segments} role="group" aria-label="Projekt">
            <button aria-pressed={selected === 'all'} onClick={() => setFilter('all')}>
              Alle
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
        {error && (
          <p className={styles.empty}>
            Einige Einträge konnten nicht geladen werden. Bitte aktualisieren.
          </p>
        )}
        {error && visible.length === 0 ? null : loading && actions.length === 0 ? (
          <p className={styles.empty}>Inbox wird geladen …</p>
        ) : visible.length === 0 ? (
          <p className={styles.empty}>Gerade wartet nichts auf dich.</p>
        ) : (
          visible.map((item) => <InboxCard key={item.key} item={item} />)
        )}
        <section className={styles.reads} aria-labelledby="reads-heading">
          <h2 id="reads-heading">ZUM LESEN</h2>
          {visibleReads.length === 0 ? (
            <p className={styles.empty}>Noch keine erledigten Läufe.</p>
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
                    {entry.project?.key.toUpperCase() ?? 'HOME'}
                  </span>
                  <span>
                    {entry.issue?.title ?? `${entry.agent?.name ?? 'Agent'} · Lauf erledigt`}
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
  return (
    <Shell globalHome globalTitle="Inbox" autoOpenGlobalChat={false} mobileHeaderOnly>
      <OwnerInboxContent />
    </Shell>
  );
}
