import type { ReactNode } from 'react';

// A settings group (docs/design-system.md §4 SettingsGroup): its title and one sentence,
// then its rows in a card — one column, at most 880px wide, on every settings page. A
// group whose whole control is the header action has no body.
export default function SettingsSection({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="ds-settings-section">
      <header className="ds-settings-section-head">
        <div>
          <h3>{title}</h3>
          {description && <p>{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>
      {children && <div className="ds-settings-section-body">{children}</div>}
    </section>
  );
}
