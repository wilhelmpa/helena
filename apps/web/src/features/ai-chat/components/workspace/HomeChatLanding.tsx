'use client';

import Link from 'next/link';
import { PanelLeft } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useSyncExternalStore, type ReactNode } from 'react';
import type { AgentActivityEntry } from '@/lib/api/endpoints/agentActivity';
import {
  useHomeActiveActivity,
  HOME_ACTIVE_STATUSES,
} from '@/features/home/services/homeKpis.service';
import { formatDurationShort } from '@/utils/dates';
import { projectColor } from '@/utils/projectColor';
import { agentActivityForAgentPath, globalAgentActivityPath, issuePath } from '@/utils/paths';
import { RUN_PARAM } from '@/features/agent-runtime/runOverlay';
import styles from './HomeChatLanding.module.css';

const subscribe = () => () => {};

function useHomeDate() {
  const locale = useLocale();
  return useSyncExternalStore(
    subscribe,
    () =>
      new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(
        new Date(),
      ),
    () => null,
  );
}

function activityHref(entry: AgentActivityEntry): string {
  if (entry.issue && entry.project) return issuePath(entry.project.key, entry.issue.sequenceNumber);
  // A run without a task opens in the run overlay over Helena.
  if (entry.kind === 'agent-run' && entry.agent && entry.id.startsWith('run:'))
    return `/?${RUN_PARAM}=${entry.agent.id}.${entry.id.slice(4)}`;
  if (entry.agent) return agentActivityForAgentPath(entry.agent.id, entry.project?.key);
  return globalAgentActivityPath();
}

export function HomeChatMasthead({ onOpenList }: { onOpenList?: () => void }) {
  const t = useTranslations('homeChat');
  const today = useHomeDate();
  const activity = useHomeActiveActivity();
  const working = new Set(
    (activity.data?.items ?? [])
      .filter((entry) => HOME_ACTIVE_STATUSES.has(entry.status) && entry.agent)
      .map((entry) => entry.agent!.id),
  ).size;

  return (
    <div className={styles.masthead}>
      <div className={styles.location}>
        <strong>{'HELENA'}</strong>
        <span>·</span>
        <span>{today?.toLocaleUpperCase() ?? ''}</span>
      </div>
      <div className={styles.mastheadRight}>
        <span className={styles.working}>
          <span className={working ? styles.pulse : styles.quietDot} />
          {t('working', { count: working })}
        </span>
        {onOpenList && (
          <button
            type="button"
            onClick={onOpenList}
            className={styles.history}
            aria-label={t('history')}
          >
            <PanelLeft size={17} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}

export function HomeChatHero({ orb, showTitle = true }: { orb: ReactNode; showTitle?: boolean }) {
  const t = useTranslations('homeChat');
  return (
    <div className={styles.hero}>
      {showTitle && <h1>{t('title')}</h1>}
      <div className={styles.orb}>{orb}</div>
    </div>
  );
}

export function HomeChatActivityCards() {
  const t = useTranslations('homeChat');
  const tActivity = useTranslations('agentActivity');
  const activity = useHomeActiveActivity();
  const items = activity.data?.items ?? [];
  const running = items.filter((entry) => entry.project && HOME_ACTIVE_STATUSES.has(entry.status));
  const finished = items.filter((entry) => entry.project && entry.status === 'success');
  const cards = [...running, ...finished].slice(0, 3);

  return (
    <div className={styles.cards} aria-label={t('recent')}>
      {cards.length === 0 && !activity.isPending ? (
        <Link href={globalAgentActivityPath()} className={styles.emptyCard}>
          {t('empty')}
          <span>{t('activity')}</span>
        </Link>
      ) : (
        cards.map((entry) => {
          const active = HOME_ACTIVE_STATUSES.has(entry.status);
          const accent = projectColor(entry.project?.key ?? 'VOL');
          return (
            <Link key={entry.id} href={activityHref(entry)} className={styles.card}>
              <span className={styles.cardTag} style={{ color: accent }}>
                <span
                  className={styles.cardDot}
                  style={{ backgroundColor: accent, boxShadow: `0 0 8px ${accent}` }}
                />
                {entry.project?.key ?? 'HELENA'}
              </span>
              <span className={styles.cardTitle}>
                {entry.issue?.title ?? tActivity(`kinds.${entry.kind}`)}
              </span>
              <span className={styles.cardMeta}>
                {entry.agent?.name ?? tActivity(`kinds.${entry.kind}`)} ·{' '}
                {active ? t('recent') : `${t('finished')} ${formatDurationShort(entry.at)}`}
              </span>
            </Link>
          );
        })
      )}
    </div>
  );
}
