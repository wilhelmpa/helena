import type { ReactNode } from 'react';

// A notice inside a page or a card (docs/design-system.md §4): a state the reader must not
// miss, with a leading icon, a short title and at most two sentences. Not a toast (it stays)
// and not an error page (the page around it still works). `danger`: something is stopped or
// refused; `warning`: something is missing or nearly used up; `neutral`: a plain hint.
export type NoticeTone = 'neutral' | 'warning' | 'danger';

export function Notice({
  tone = 'neutral',
  icon,
  title,
  children,
  action,
}: {
  tone?: NoticeTone;
  // A lucide icon element (<OctagonAlert />).
  icon?: ReactNode;
  title?: ReactNode;
  children?: ReactNode;
  // Something the reader can do about it (a button); never an order.
  action?: ReactNode;
}) {
  return (
    <div className="ds-notice" data-tone={tone} role={tone === 'neutral' ? 'note' : 'alert'}>
      {icon && (
        <span className="ds-notice-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <div className="ds-notice-body">
        {title && <p className="ds-notice-title">{title}</p>}
        {children && <p className="ds-notice-text">{children}</p>}
      </div>
      {action && <div className="ds-notice-action">{action}</div>}
    </div>
  );
}
