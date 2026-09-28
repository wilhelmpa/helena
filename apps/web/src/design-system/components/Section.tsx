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

// A sentence and the page's own main action, nothing else.
export function EmptyState({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="ds-empty">
      <p>{children}</p>
      {action}
    </div>
  );
}
