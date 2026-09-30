'use client';

import { useState, type HTMLAttributes, type ReactNode } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { StatusDot, type StatusDotTone } from './StatusDot';

// A list (docs/design-system.md §4): 36px rows, 12px side padding, a 16px icon on the
// left in text-3, meta on the right in mono 12; hover surface-2, selection surface-3.
// Group heads are mono labels with a count and fold.

export function List({
  children,
  label,
  className,
}: {
  children: ReactNode;
  label?: string;
  className?: string;
}) {
  return (
    <div role="list" aria-label={label} className={`ds-list ${className ?? ''}`}>
      {children}
    </div>
  );
}

export function ListGroup({
  label,
  count,
  children,
  defaultOpen = true,
  actions,
}: {
  label: ReactNode;
  count?: number;
  children: ReactNode;
  defaultOpen?: boolean;
  actions?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="ds-list-group" role="group">
      <div className="ds-list-group-head">
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="ds-mono-label">{label}</span>
          {count != null && <span className="ds-list-group-count">{count}</span>}
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        {actions}
      </div>
      {open && children}
    </div>
  );
}

type RowProps = {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  dot?: StatusDotTone | null;
  actions?: ReactNode;
  // A control that stays visible beside the row (a switch): outside the row's button, so it is
  // never a button in a button, and not hidden until hover like `actions`.
  control?: ReactNode;
  selected?: boolean;
  // The title is a sentence: it wraps to as many lines as it needs instead of ending in "…".
  wrap?: boolean;
  href?: string;
  onSelect?: () => void;
} & Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'onSelect'>;

export function ListRow({
  icon,
  title,
  subtitle,
  meta,
  dot,
  actions,
  control,
  selected,
  wrap = false,
  href,
  onSelect,
  className,
  ...props
}: RowProps) {
  const body = (
    <>
      {icon && <span className="ds-list-icon">{icon}</span>}
      <span className="ds-list-text">
        <span className="ds-list-title">{title}</span>
        {subtitle && <span className="ds-list-subtitle">{subtitle}</span>}
      </span>
      {dot && <StatusDot tone={dot} />}
      {meta != null && <span className="ds-list-meta">{meta}</span>}
    </>
  );
  return (
    <div
      role="listitem"
      className={`ds-list-row ${selected ? 'is-selected' : ''} ${className ?? ''}`}
      data-wrap={wrap ? '' : undefined}
      {...props}
    >
      {href ? (
        <Link href={href} className="ds-list-main" aria-current={selected ? 'true' : undefined}>
          {body}
        </Link>
      ) : onSelect ? (
        <button type="button" className="ds-list-main" onClick={onSelect} aria-pressed={selected}>
          {body}
        </button>
      ) : (
        <div className="ds-list-main">{body}</div>
      )}
      {control && <span className="ds-list-control">{control}</span>}
      {actions && <span className="ds-list-actions">{actions}</span>}
    </div>
  );
}
