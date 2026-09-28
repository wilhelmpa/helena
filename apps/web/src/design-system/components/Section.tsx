import type { ReactNode } from 'react';

// A section of a page (docs/design-system.md §4): an 18px title, at most one sentence
// under it, 24px to the content; no frame around the whole section.
export function Section({
  title,
  description,
  actions,
  children,
  id,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section className="ds-section" id={id}>
      {(title || actions) && (
        <header className="ds-section-head">
          <div>
            {title && <h2 className="ds-section-title">{title}</h2>}
            {description && <p className="ds-section-description">{description}</p>}
          </div>
          {actions && <div className="ds-section-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

// A small monospaced caps label (group heads, eyebrows, column heads).
export function MonoLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={`ds-mono-label ${className ?? ''}`}>{children}</span>;
}

// An empty area (owner, O62): a symbol, one sentence, the page's main action — never a
// grey line under empty table heads. `fill` centres it in the room left on the page.
export function EmptyState({
  icon,
  title,
  children,
  action,
  fill = true,
}: {
  // A lucide icon element (<Inbox />).
  icon?: ReactNode;
  // Optional short title above the sentence ("Noch keine Belege").
  title?: ReactNode;
  // The one sentence.
  children?: ReactNode;
  // The same main action the page header offers, if any.
  action?: ReactNode;
  fill?: boolean;
}) {
  return (
    <div className="ds-empty" data-fill={fill ? '' : undefined} role="status">
      {icon && (
        <span className="ds-empty-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      {title && <p className="ds-empty-title">{title}</p>}
      {children && <p className="ds-empty-text">{children}</p>}
      {action && <div className="ds-empty-action">{action}</div>}
    </div>
  );
}
