'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { More } from './DetailView';

// Settings (docs/design-system.md §4): a card per topic with a title, rows of label +
// one sentence + the control on the right (56px), at most six rows; the rest under
// "Erweitert".
export function SettingsGroup({
  title,
  description,
  children,
  advanced,
  advancedLabel,
  id,
}: {
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  advanced?: ReactNode;
  // The fold's name when it holds something else than advanced settings.
  advancedLabel?: ReactNode;
  id?: string;
}) {
  const t = useTranslations('common');
  return (
    <section className="ds-settings-group" id={id}>
      {title && (
        <header className="ds-settings-group-head">
          <h3>{title}</h3>
          {description && <p>{description}</p>}
        </header>
      )}
      <div className="ds-settings-rows">{children}</div>
      {advanced && <More label={advancedLabel ?? t('advanced')}>{advanced}</More>}
    </section>
  );
}

export function SettingsRow({
  label,
  description,
  children,
  htmlFor,
  danger = false,
  stacked = false,
  nested = false,
}: {
  label: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  htmlFor?: string;
  danger?: boolean;
  // A wide control (a text area, a list) sits below the text, full width.
  stacked?: boolean;
  // A setting that belongs to the row above (its wait, its detail): indented under it.
  nested?: boolean;
}) {
  return (
    <div
      className={`ds-settings-row ${danger ? 'is-danger' : ''} ${stacked ? 'is-stacked' : ''} ${nested ? 'is-nested' : ''}`}
    >
      <div className="ds-settings-row-text">
        {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span>{label}</span>}
        {description && <p>{description}</p>}
      </div>
      {children && <div className="ds-settings-row-control">{children}</div>}
    </div>
  );
}
