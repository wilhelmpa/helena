'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Activity } from 'lucide-react';
import { PageActions } from '@/design-system';
import {
  useHomeActiveActivity,
  HOME_ACTIVE_STATUSES,
} from '@/features/home/services/homeKpis.service';
import { formatDurationShort } from '@/utils/dates';
import { projectColor } from '@/utils/projectColor';
import { globalAgentActivityPath } from '@/utils/paths';
import {
  activityEntryHref as activityHref,
  runningActivityHref,
} from '@/features/agent-activity/utils/runningLink';
import { useSession } from '@/lib/auth-client';
import { useDisplayName } from '@/context/displayName';
import '@/extensions/homeWidgets';
import { useNeedsYou } from '@/features/home/dashboard/useNeedsYou';
import { startCards } from '@/features/home/utils/startCards';
import { openSystemDetails } from '@/features/home/dashboard/systemDetails';
import styles from './HomeChatLanding.module.css';

// The start cards show only what cannot be hidden (problems and decisions).
const NOTHING_HIDDEN: ReadonlySet<string> = new Set();

// Who is working right now: the one action of the Home chat page's header bar (owner 30.09.,
// O104: the page has the standard bar like every page, no bar of its own).
export function HomeChatWorking() {
  const t = useTranslations('homeChat');
  const activity = useHomeActiveActivity();
  const active = (activity.data?.items ?? []).filter(
    (entry) => HOME_ACTIVE_STATUSES.has(entry.status) && entry.agent,
  );
  const working = new Set(active.map((entry) => entry.agent!.id)).size;
  return (
    <PageActions
      primary={{
        id: 'working',
        label: t('working', { count: working }),
        icon: Activity,
        href: runningActivityHref(active, null),
      }}
    />
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
  const appName = useDisplayName();
  const tActivity = useTranslations('agentActivity');
  const activity = useHomeActiveActivity();
  const { data: session } = useSession();
  // "Braucht dich" first (owner, D): what waits for a decision or is red now, then the work.
  const needs = useNeedsYou(NOTHING_HIDDEN, session?.user.role === 'god');
  const cards = startCards(needs.items, activity.data?.items ?? []);

  return (
    <div className={styles.cards} aria-label={t('recent')}>
      {cards.length === 0 && !activity.isPending ? (
        <Link href={globalAgentActivityPath()} className={styles.emptyCard}>
          {t('empty')}
          <span>{t('activity')}</span>
        </Link>
      ) : (
        cards.map((card) => {
          if (card.kind === 'needs') {
            const { entry } = card;
            const accent =
              entry.kind === 'problem' ? 'var(--status-danger)' : 'var(--status-waiting)';
            const body = (
              <>
                <span className={styles.cardTag} style={{ color: accent }}>
                  <span className={styles.cardDot} style={{ backgroundColor: accent }} />
                  {t('needsYou')}
                </span>
                <span className={styles.cardTitle}>{entry.title}</span>
                <span className={styles.cardMeta}>{entry.detail || entry.projectKey || ''}</span>
              </>
            );
            // The health overview lives on the dashboard: a problem that opens it there.
            const href =
              entry.href ?? (entry.onSelect === openSystemDetails ? '/dashboard?system=1' : null);
            return href ? (
              <Link key={entry.key} href={href} className={styles.card}>
                {body}
              </Link>
            ) : (
              <button
                key={entry.key}
                type="button"
                className={styles.card}
                onClick={entry.onSelect}
              >
                {body}
              </button>
            );
          }
          const { entry } = card;
          const active = card.kind === 'running';
          const accent = projectColor(entry.project?.key ?? 'VOL');
          return (
            <Link key={entry.id} href={activityHref(entry)} className={styles.card}>
              <span className={styles.cardTag} style={{ color: accent }}>
                <span className={styles.cardDot} style={{ backgroundColor: accent }} />
                {entry.project?.key ?? appName.toLocaleUpperCase()}
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
