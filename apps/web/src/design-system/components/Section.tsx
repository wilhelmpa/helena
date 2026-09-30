import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';
import { Card } from './Card';

// A section of a page (docs/ui-framework.md §19): a 15px title, at most one sentence under it,
// --section-head-gap to its content (which stands --stack-gap apart); no frame around the
// whole section, sections stand --section-gap apart. SettingsGroup is the same section.
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
      <div className="ds-section-body">{children}</div>
    </section>
  );
}

// A small monospaced caps label (group heads, eyebrows, column heads, a widget's name).
export function MonoLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={`ds-mono-label ${className ?? ''}`}>{children}</span>;
}

// Its quiet companion: mono meta in the same size, no caps (a count, a time, a key).
export function MonoMeta({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={`ds-mono-meta ${className ?? ''}`}>{children}</span>;
}

// An empty area (owner, O62; docs/ui-framework.md §19): a symbol (always one - a neutral tray
// when the caller has none), an optional title, one sentence, the page's main action - never a
// grey line under empty table heads. `fill` is the page's own empty state: it stands in a
// block of the same height on every page, so the symbol is always in the same place; without
// it (in a box, a panel) it is a compact block.
export function EmptyState({
  icon,
  title,
  children,
  action,
  fill = true,
  boxed = false,
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
  // In its own box (a list or a group that has nothing yet): a Card around a compact block.
  boxed?: boolean;
}) {
  const block = (
    <div
      className="ds-empty"
      data-fill={fill && !boxed ? '' : undefined}
      data-boxed={boxed ? '' : undefined}
      role="status"
    >
      <span className="ds-empty-icon" aria-hidden="true">
        {icon ?? <Inbox />}
      </span>
      {title && <p className="ds-empty-title">{title}</p>}
      {children && <p className="ds-empty-text">{children}</p>}
      {action && <div className="ds-empty-action">{action}</div>}
    </div>
  );
  return boxed ? <Card pad="none">{block}</Card> : block;
}

// The head of a group of rows above its box: the group's name as a mono label, its count, and
// (optional) what belongs to it at the right (a link, a button). One height (32px), one inset
// (8px): every grouped list of a page - tasks by project, receipts by state - starts this way.
export function GroupHead({
  children,
  count,
  actions,
  icon,
  as: Tag = 'h2',
}: {
  children: ReactNode;
  count?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  as?: 'h2' | 'h3' | 'div';
}) {
  return (
    <Tag className="ds-group-head">
      {icon}
      <MonoLabel className="ds-group-head-label">{children}</MonoLabel>
      {count != null && count !== false && <MonoMeta>{count}</MonoMeta>}
      {actions}
    </Tag>
  );
}
