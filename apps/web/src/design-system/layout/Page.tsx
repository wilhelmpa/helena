import type { ReactNode, Ref } from 'react';

// Every page is made of these (docs/design-system.md §3, owner 30.09., O104):
//   PageHeader   ONE 56px bar: the page's name on the left (18px, text colour, no
//                breadcrumb - the sidebar says where you are), then every control of the page
//                in the bar's own slot (`bar`: tabs, search, filters, view, at fixed places,
//                see PageToolbar), and the page's main action at the right end. Below 900px
//                the controls fold under the name into a 44px row of the same bar.
//   PageBody     24px top, 32px sides, 48px bottom; the full width, no own container.

export function PageHeader({
  title,
  actions,
  actionsRef,
  barRef,
  bar,
  lead,
  titleRef,
}: {
  title: ReactNode;
  actions?: ReactNode;
  // The element a page's toolbar puts its main action into (see ShellHeaderActionsSlotCtx).
  actionsRef?: Ref<HTMLDivElement>;
  // The element a page's toolbar renders its controls into (see ShellHeaderSlotCtx).
  barRef?: Ref<HTMLDivElement>;
  bar?: ReactNode;
  // Before the name: the sidebar button on a narrow window.
  lead?: ReactNode;
  titleRef?: Ref<HTMLDivElement>;
}) {
  return (
    <header className="ds-page-header" data-app-header="">
      {lead}
      <div className="ds-page-heading" ref={titleRef}>
        <h1 className="ds-page-title">{title}</h1>
      </div>
      <div className="ds-page-bar" ref={barRef} data-slot="app-page-bar">
        {bar}
      </div>
      <div className="ds-page-actions" ref={actionsRef} data-slot="app-header-page">
        {actions}
      </div>
    </header>
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
