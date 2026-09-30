'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useShellHeaderActionsSlot } from '@/context/shellHeaderSlot';
import { PageToolbar } from './PageToolbar';
import { usePageChrome } from './pageChrome';

// The page template (docs/ui-framework.md, docs/ui-befunde-2026-09-28.md §A). EVERY page
// inside the app frame renders exactly one <Page>; a test (pageTemplate.test.ts) fails
// for a route that does not. The frame around it is always the same:
//
//   ┌ header (Shell) ─ PROJEKT · BEREICH / Titel ─────────────── [Hauptaktion] ┐
//   ├ toolbar ─ Tabs · Filter · Suche (one row, fixed place, hidden when empty) ┤
//   │ body ─ 24px to the top, 32px to the sides (16 on a phone), full width     │
//   └───────────────────────────────────────────────────────────────────────────┘
//
// The title and breadcrumb come from the Shell (one size on every page); a page only
// says what goes into the action slot, the toolbar and the body.
//
//   variant 'default'  the body scrolls, padded (lists, tables, settings, dashboards)
//           'fill'     padded, the child fills the height and scrolls itself (board,
//                      org chart, a split view)
//           'bleed'    no padding, fills (canvas, terminal, code, an embedded app)
//           'split'    like bleed for a list and its detail (inbox, mail): the list starts at the
//                      sidebar's edge and the detail reaches the window's (owner 29.09., O74)
//           'reading'  scrolls, text centred at most 760px (a document)
export type PageVariant = 'default' | 'fill' | 'bleed' | 'split' | 'reading';

// A page shown inside another page (a section of Helena's settings is an older page of
// its own; the agent dialog shows pages): the outer one owns the frame, the inner one
// adds only its toolbar, its actions and its content — no second padding or scroll box.
const PageNestCtx = createContext(false);

export function Page({
  title,
  actions,
  toolbar,
  variant = 'default',
  children,
  label,
}: {
  // The page's name for screen readers and outside the Shell (the header shows it).
  title?: string;
  // The page's main action ("+ Neue Aufgabe") and, if any, its "…" menu (PageActions).
  // Rendered at the right of the header row.
  actions?: ReactNode;
  // Tabs, filters, search (PageTabs, PageSelect, FilterBar, PageSearch): the row under
  // the header. One pattern, one place, on every page.
  toolbar?: ReactNode;
  variant?: PageVariant;
  children?: ReactNode;
  // aria-label of the page region, if the title is not enough.
  label?: string;
}) {
  const actionsSlot = useShellHeaderActionsSlot();
  const chrome = usePageChrome();
  // Inside a modal that already names the page (agent dialog, Mein Konto) the actions sit
  // in a row of their own at the top of the body; without the Shell ('classic' header
  // layout, a public page) likewise.
  const inlineActions = actions != null && (chrome === 'modal' || !actionsSlot);
  const nested = useContext(PageNestCtx);
  const portalled =
    actions != null && actionsSlot && chrome !== 'modal'
      ? createPortal(<div className="ds-page-actions-group">{actions}</div>, actionsSlot)
      : null;
  if (nested) {
    return (
      <div className="ds-page-nested" data-page-nested={variant}>
        {portalled}
        {toolbar != null && <PageToolbar>{toolbar}</PageToolbar>}
        {inlineActions && <div className="ds-page-inline-actions">{actions}</div>}
        {children}
      </div>
    );
  }
  return (
    <div className="ds-page" data-page={variant} aria-label={label}>
      {title && <h1 className="sr-only">{title}</h1>}
      {portalled}
      {toolbar != null && <PageToolbar>{toolbar}</PageToolbar>}
      <div className="ds-page-scroll @container/page">
        <div className="ds-page-body">
          {inlineActions && <div className="ds-page-inline-actions">{actions}</div>}
          <PageNestCtx.Provider value>{children}</PageNestCtx.Provider>
        </div>
      </div>
    </div>
  );
}
