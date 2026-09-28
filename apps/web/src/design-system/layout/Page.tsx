import { Fragment, type ReactNode, type Ref } from 'react';
import Link from 'next/link';

// Every page is made of these (docs/design-system.md §3):
//   PageHeader   one 56px row: the breadcrumb as a mono label in the project colour
//                ("TRADING · AUFGABEN /"), then the title (18px, text colour); on the
//                right at most one main action.
//   PageToolbar  optional 44px row: filters, view, search.
//   PageBody     24px top, 32px sides, 48px bottom; the full width, no own container.

export type Crumb = { label: string; href?: string };

export function PageHeader({
  crumbs = [],
  title,
  accent,
  actions,
  actionsRef,
  lead,
  titleRef,
}: {
  crumbs?: Crumb[];
  title: ReactNode;
  // The project colour of the breadcrumb (a CSS colour or var()).
  accent?: string;
  actions?: ReactNode;
  // The element a page's toolbar puts its main action into (see ShellHeaderActionsSlotCtx).
  actionsRef?: Ref<HTMLDivElement>;
  // Before the breadcrumb: the sidebar button on a narrow window.
  lead?: ReactNode;
  titleRef?: Ref<HTMLDivElement>;
}) {
  return (
    <header className="ds-page-header" data-app-header="">
      {lead}
      <div
        className="ds-page-heading"
        ref={titleRef}
        style={accent ? ({ '--ds-crumb': accent } as React.CSSProperties) : undefined}
      >
        {crumbs.length > 0 && (
          <span className="ds-page-crumbs">
            {crumbs.map((crumb, index) => (
              <Fragment key={`${index}:${crumb.label}`}>
                {index > 0 && (
                  <span className="ds-page-crumb-sep" aria-hidden="true">
                    ·
                  </span>
                )}
                {crumb.href ? (
                  <Link href={crumb.href}>{crumb.label}</Link>
                ) : (
                  <span>{crumb.label}</span>
                )}
              </Fragment>
            ))}
            <span className="ds-page-crumb-slash" aria-hidden="true">
              /
            </span>
          </span>
        )}
        <h1 className="ds-page-title">{title}</h1>
      </div>
      <div className="ds-page-actions" ref={actionsRef} data-slot="app-header-page">
        {actions}
      </div>
    </header>
  );
}

// The 44px row under the header; hidden while nothing is in it.
export function PageToolbarRow({
  children,
  slotRef,
}: {
  children?: ReactNode;
  slotRef?: Ref<HTMLDivElement>;
}) {
  return (
    <div className="ds-page-toolbar" ref={slotRef} data-slot="app-page-bar">
      {children}
    </div>
  );
}

// The page content with the one padding every page has. `bleed` lets a board or a
// canvas reach the edges (it still starts under the same header).
export function PageBody({
  children,
  bleed = false,
  reading = false,
  className,
}: {
  children: ReactNode;
  bleed?: boolean;
  // Docs: centred reading text, at most 760px wide.
  reading?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`ds-page-body ${bleed ? 'is-bleed' : ''} ${reading ? 'is-reading' : ''} ${className ?? ''}`}
    >
      {children}
    </div>
  );
}
