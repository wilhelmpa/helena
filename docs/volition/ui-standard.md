# Helena UI standard (2026-09-24)

The owner's rules, in one place. Every page follows them; a page that does not is a bug.

## One row
- The app header is the only header. It holds: sidebar toggle | breadcrumb (project › page) | **the page's toolbar** | the app's tools.
- A page puts everything it offers into ONE `<PageToolbar>` (`components/layout/PageToolbar.tsx`):
  `PageTabs` (its views), `PageToolbarSpacer`, `PageSearch` (its filter field), its own compact controls (`PAGE_CONTROL_CLASS`, `usePageToolbarRoom`), `PageActions` (icon actions + at most one filled primary action).
- No second or third row of tabs, filters or buttons under the header. No intro/description line under the header.
- The toolbar folds itself when room runs out (search → icon, actions → "…", primary → icon, tabs → dropdown). Below 1024px it moves into its own 44px row under the header (Shell's page bar) — same on every page.

## Type (Inter, the sidebar is the reference)
- 13px (`text-sm`) rows, cells, controls, paragraphs. 12px (`text-xs`) labels, meta, badges. 14px (`text-md`) section/panel/dialog titles. 16px (`text-base`) only the one page title a page may have (Home greeting, a task title).

## Surfaces
- Boxes (cards, list groups, board columns) use the sidebar's surface (`bg-card` = sidebar tone), hover and selected use the sidebar accent (`hover:bg-accent`, `bg-accent`). One material everywhere.
- 32px controls, 16px icons, `rounded-md`. Only popovers, menus and dialogs float with a shadow.

## Buttons
- One filled (dark) button per page at most: its primary action, in the toolbar. Section-level "add" buttons in the body are `variant="outline" size="sm"` or ghost.

## Mobile
- Must look good at 390px: header = toggle, page name, tools; page toolbar in the bar below; no horizontal page scroll; touch targets ≥ 40px (globals.css raises controls on coarse pointers).
