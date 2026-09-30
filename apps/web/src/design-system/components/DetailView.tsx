'use client';

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, ChevronRight } from 'lucide-react';

// The detail of one thing — a task, an agent, a receipt (docs/design-system.md §4): a
// head (large title, status, one line of meta), then groups: content, properties (a
// two-column label/value grid, at most ~8 shown), history, links; rare fields fold
// under "Mehr".

export function DetailView({ children, className }: { children: ReactNode; className?: string }) {
  return <article className={`ds-detail ${className ?? ''}`}>{children}</article>;
}

export function DetailHeader({
  title,
  status,
  meta,
  actions,
}: {
  title: ReactNode;
  status?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="ds-detail-head">
      <div className="ds-detail-titles">
        <div className="ds-detail-title-row">
          <h2 className="ds-detail-title">{title}</h2>
          {status}
        </div>
        {meta && <p className="ds-detail-meta">{meta}</p>}
      </div>
      {actions && <div className="ds-detail-actions">{actions}</div>}
    </header>
  );
}

export function DetailGroup({
  title,
  actions,
  children,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="ds-detail-group">
      {(title || actions) && (
        <header className="ds-detail-group-head">
          {title && <h3 className="ds-mono-label">{title}</h3>}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

// Label/value pairs in two columns; `columns={1}` for a narrow place (an overlay), where two
// columns of label and value would each be too tight to read.
export function PropertyGrid({ children, columns = 2 }: { children: ReactNode; columns?: 1 | 2 }) {
  return (
    <dl className="ds-props" data-columns={columns}>
      {children}
    </dl>
  );
}

export function Property({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="ds-prop">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

// "Mehr": the rare fields and settings, folded.
export function More({
  label,
  children,
  defaultOpen = false,
}: {
  label?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const t = useTranslations('common');
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="ds-more">
      <button
        type="button"
        className="ds-more-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {label ?? t('more')}
      </button>
      {open && <div className="ds-more-body">{children}</div>}
    </div>
  );
}
