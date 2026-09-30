import type { CSSProperties, ReactNode } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { Card } from '@/design-system/components/Card';
import { MonoLabel } from '@/design-system/components/Section';
import styles from './DashboardPrimitives.module.css';

// The box, the mono label and the mono meta are the design system's own (docs/ui-framework.md
// §19): a dashboard has no card of its own. They are re-exported here for the widgets that
// import them from this file.
export { Card } from '@/design-system/components/Card';
export { MonoLabel, MonoMeta } from '@/design-system/components/Section';

export function DashboardTitle({ children }: { children: ReactNode }) {
  return <h1 className={styles.pageTitle}>{children}</h1>;
}

// A project on the dashboard: its colour on the start edge, name and key, one line of
// facts, and an optional footer (its budget bar). The whole tile opens the project.
export function ProjectTile({
  href,
  accent,
  name,
  projectKey,
  count,
  countLabel,
  progress,
  progressLabel,
  live,
  facts,
  footer,
}: {
  href: string;
  // A colour token of the project (utils/projectColor).
  accent: string;
  name: ReactNode;
  projectKey: string;
  // The big number (open tasks) and what it counts; left out while it loads.
  count?: number | null;
  countLabel?: ReactNode;
  // 0–1: how much of it is moving (tasks in progress of the open ones).
  progress?: number | null;
  progressLabel?: ReactNode;
  // Agents working in it now ("2 arbeiten"), with a pulse.
  live?: ReactNode;
  facts?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Card
      as={Link}
      href={href}
      interactive
      gap={2}
      className={styles.projectTile}
      style={{ '--project-accent': accent } as CSSProperties}
    >
      <span className={styles.projectTop}>
        <span className={styles.projectKey}>{projectKey}</span>
        {live && (
          <span className={styles.projectLive}>
            <span className={styles.projectPulse} aria-hidden="true" />
            {live}
          </span>
        )}
      </span>
      <span className={styles.projectName} dir="auto">
        {name}
      </span>
      <span className={styles.projectStats}>
        <span className={styles.projectCount}>{count ?? '–'}</span>
        {countLabel && <span className={styles.projectCountLabel}>{countLabel}</span>}
      </span>
      {progress != null && (
        <span className={styles.projectProgress}>
          <span className={styles.projectTrack} aria-hidden="true">
            <span
              className={styles.projectFill}
              style={{ width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%` }}
            />
          </span>
          {progressLabel && <span className={styles.projectProgressLabel}>{progressLabel}</span>}
        </span>
      )}
      {facts && <span className={styles.projectFacts}>{facts}</span>}
      {footer}
    </Card>
  );
}

export function Tile({
  label,
  value,
  note,
  tone = 'default',
  status,
  progress,
  href,
  onSelect,
  title,
  compact = false,
}: {
  label: ReactNode;
  value: ReactNode | null;
  note?: ReactNode;
  tone?: 'default' | 'positive' | 'attention';
  status?: ReactNode;
  progress?: { percent: number; className?: string } | null;
  href?: string;
  onSelect?: () => void;
  title?: string;
  // Money and other long figures: a smaller number and a note that may wrap.
  compact?: boolean;
}) {
  const content = (
    <>
      <span className="flex items-center justify-between gap-2">
        <MonoLabel>{label}</MonoLabel>
        {status}
      </span>
      {value === null ? (
        <span
          aria-hidden="true"
          className="h-9 w-12 animate-pulse rounded-sm bg-[var(--dashboard-raised)]"
        />
      ) : (
        <span
          className={cn(
            styles.value,
            compact && styles.compactValue,
            tone !== 'default' && styles[tone],
          )}
        >
          {value}
        </span>
      )}
      {progress && (
        <span className={styles.progress}>
          <span
            className={cn(styles.progressFill, progress.className)}
            style={{ width: `${Math.max(0, Math.min(100, progress.percent))}%` }}
          />
        </span>
      )}
      <span className={styles.note}>{note}</span>
    </>
  );
  const className = cn(styles.tile, compact && styles.compact);
  const tooltip = title;
  if (href)
    return (
      <Card as={Link} href={href} interactive gap={2} tooltip={tooltip} className={className}>
        {content}
      </Card>
    );
  if (onSelect)
    return (
      <Card
        as="button"
        type="button"
        onClick={onSelect}
        interactive
        gap={2}
        tooltip={tooltip}
        className={className}
      >
        {content}
      </Card>
    );
  return (
    <Card gap={2} tooltip={tooltip} className={className}>
      {content}
    </Card>
  );
}
