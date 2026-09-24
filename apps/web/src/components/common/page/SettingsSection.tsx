import type { ReactNode } from 'react';

// A settings section (docs/volition-design-helena-ui.md "SettingsSection"): its title
// and one-line explanation, then its body — the fields in a SettingsCard. Two columns
// once the page column is wide enough (a container query on SectionPageView's
// @container/page, so it also works beside the settings rail): the title block on the
// left, sticky while its fields scroll, the body on the right. One column below that.
// A section whose whole control is the header action has no body.
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
    <section className="grid grid-cols-1 gap-3 @3xl/page:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] @3xl/page:gap-6">
      <header className="flex items-start justify-between gap-4 @3xl/page:sticky @3xl/page:top-0 @3xl/page:flex-col @3xl/page:justify-start @3xl/page:self-start">
        <div className="space-y-0.5">
          <h3 className="text-md font-semibold">{title}</h3>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>
      {children && <div className="min-w-0">{children}</div>}
    </section>
  );
}
