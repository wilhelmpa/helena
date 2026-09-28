import type { HTMLAttributes, ReactNode } from 'react';

// A card (docs/design-system.md §4): surface-1, radius 12, padding 16, a 1px line and a
// soft shadow; title 13/520, meta 12.
export function Card({
  title,
  meta,
  actions,
  children,
  className,
  interactive = false,
  selected = false,
  ...props
}: Omit<HTMLAttributes<HTMLDivElement>, 'title'> & {
  title?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  interactive?: boolean;
  selected?: boolean;
}) {
  return (
    <div
      className={`ds-card ${interactive ? 'is-interactive' : ''} ${selected ? 'is-selected' : ''} ${className ?? ''}`}
      {...props}
    >
      {(title || actions) && (
        <div className="ds-card-head">
          {title && <div className="ds-card-title">{title}</div>}
          {actions && <div className="ds-card-actions">{actions}</div>}
        </div>
      )}
      {meta && <div className="ds-card-meta">{meta}</div>}
      {children}
    </div>
  );
}
