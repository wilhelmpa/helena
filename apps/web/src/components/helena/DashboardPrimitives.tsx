import type { HTMLAttributes, ReactNode } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import styles from './DashboardPrimitives.module.css';

export function Card({
  as: Element = 'section',
  variant = 'surface',
  className,
  ...props
}: HTMLAttributes<HTMLElement> & {
  as?: 'section' | 'article' | 'div';
  variant?: 'surface' | 'raised' | 'selected';
}) {
  return (
    <Element
      className={cn(styles.card, variant !== 'surface' && styles[variant], className)}
      {...props}
    />
  );
}

export function MonoLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn(styles.label, className)}>{children}</span>;
}

export function MonoMeta({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn(styles.meta, className)}>{children}</span>;
}

export function DashboardTitle({ children }: { children: ReactNode }) {
  return <h1 className={styles.pageTitle}>{children}</h1>;
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
          className="h-9 w-12 animate-pulse rounded bg-[var(--dashboard-raised)]"
        />
      ) : (
        <span className={cn(styles.value, tone !== 'default' && styles[tone])}>{value}</span>
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
  const className = cn(styles.card, styles.tile, (href || onSelect) && styles.interactive);
  if (href)
    return (
      <Link href={href} className={className} title={title}>
        {content}
      </Link>
    );
  if (onSelect)
    return (
      <button type="button" onClick={onSelect} className={className} title={title}>
        {content}
      </button>
    );
  return (
    <Card className={styles.tile} title={title}>
      {content}
    </Card>
  );
}
