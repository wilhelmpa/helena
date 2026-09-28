import type { ReactNode } from 'react';
import { More } from './DetailView';

// Settings (docs/design-system.md §4): a card per topic with a title, rows of label +
// one sentence + the control on the right (56px), at most six rows; the rest under
// "Erweitert".
export function SettingsGroup({
  title,
  description,
  children,
  advanced,
  id,
}: {
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  advanced?: ReactNode;
  id?: string;
}) {
  return (
    <section className="ds-settings-group" id={id}>
      {title && (
        <header className="ds-settings-group-head">
          <h3>{title}</h3>
          {description && <p>{description}</p>}
        </header>
      )}
      <div className="ds-settings-rows">{children}</div>
      {advanced && <More label="Erweitert">{advanced}</More>}
    </section>
  );
}

export function SettingsRow({
  label,
  description,
  children,
  htmlFor,
  danger = false,
}: {
  label: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  htmlFor?: string;
  danger?: boolean;
}) {
  return (
    <div className={`ds-settings-row ${danger ? 'is-danger' : ''}`}>
      <div className="ds-settings-row-text">
        {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span>{label}</span>}
        {description && <p>{description}</p>}
      </div>
      {children && <div className="ds-settings-row-control">{children}</div>}
    </div>
  );
}
