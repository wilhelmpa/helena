import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';

// One page of the agent dialog (docs/ui-framework.md): the heading with its one sentence, an
// optional count or action on the right, then the body. The pages of the settings, the Skills
// tab and the Memory tab all sit in this frame, so their left edge, their heading and the
// distance between their groups are the same. `back` turns the heading into the way out of a
// detail (one skill) back to its list.
export function AgentPage({
  title,
  hint,
  count,
  actions,
  back,
  children,
}: {
  title: ReactNode;
  hint?: ReactNode;
  count?: ReactNode;
  actions?: ReactNode;
  back?: { label: string; onClick: () => void };
  children: ReactNode;
}) {
  return (
    <section className="ds-agent-page">
      {back && (
        <button type="button" className="ds-agent-page-back" onClick={back.onClick}>
          <ArrowLeft aria-hidden="true" />
          {back.label}
        </button>
      )}
      <header className="ds-agent-page-head">
        <div>
          <h2>{title}</h2>
          {hint && <p>{hint}</p>}
        </div>
        {count != null && <span className="ds-agent-page-count">{count}</span>}
        {actions}
      </header>
      <div className="ds-agent-page-body">{children}</div>
    </section>
  );
}

// The scroll container of a page of the agent dialog.
export function AgentPages({ children }: { children: ReactNode }) {
  return <div className="ds-agent-pages">{children}</div>;
}
