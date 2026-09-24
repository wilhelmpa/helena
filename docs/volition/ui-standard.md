# Helena UI standard (2026-09-24)

The owner's rules, in one place. Every page follows them; a page that does not is a bug.

## One row
- The app header is the only header. It holds: sidebar toggle | breadcrumb (project › page) | **the page's toolbar** | the app's tools.
- A page puts everything it offers into ONE `<PageToolbar>` (`components/layout/PageToolbar.tsx`):
  `PageTabs` (its views), `PageToolbarSpacer` (a thin divider, it does NOT push anything right), `PageSearch` (its filter field), its own compact controls (`PAGE_CONTROL_CLASS`, `usePageToolbarRoom`), `PageActions` (icon actions + at most one primary action). **The page's controls are one group right after its name** (owner 2026-09-24: "eine Sinneinheit mit dem Inhalt der Seite"); only the global tools sit at the far right.
- No second or third row of tabs, filters or buttons under the header. No intro/description line under the header.
- The toolbar folds itself when room runs out (search → icon, actions → "…", primary → icon, tabs → dropdown). Below 1024px it moves into its own 44px row under the header (Shell's page bar) — same on every page.

## Type (Inter, the sidebar is the reference)
- 13px (`text-sm`) rows, cells, controls, paragraphs. 12px (`text-xs`) labels, meta, badges. 14px (`text-md`) section/panel/dialog titles. 16px (`text-base`) only the one page title a page may have (Home greeting, a task title).

## Surfaces
- Boxes (cards, list groups, board columns) use the sidebar's surface (`bg-card` = sidebar tone), hover and selected use the sidebar accent (`hover:bg-accent`, `bg-accent`). One material everywhere.
- 32px controls, 16px icons, `rounded-md`. Only popovers, menus and dialogs float with a shadow.

## Buttons
- Every "New ..." of a page (`PageActions` primary, `PAGE_PRIMARY_CLASS`, also "Neue Ansicht"/"Neues Dashboard" at the end of a tab strip) looks the same: a quiet outlined button on the sidebar surface with a plus icon. No dark-filled buttons in the header. Section-level "add" buttons in the body are `variant="outline" size="sm"` or ghost.

## Mobile
- Must look good at 390px: header = toggle, page name, tools; page toolbar in the bar below; no horizontal page scroll; touch targets ≥ 40px (globals.css raises controls on coarse pointers).

## Spacing (owner, 2026-09-24: "Padding im Hauptbereich überall homogen wie beim Dashboard"; "Dashboard-Grid identisch zum Rand")
- The main area has a 16px gutter on every side at every width (`PAGE_GUTTER_CLASS`). No centred columns, no `xl:px-12`.
- Lists, tables, grids and overviews use the whole width (`SectionPageView wide`). Forms keep the left-aligned column (`SECTION_COLUMN_CLASS`), so the left edge is the same everywhere.
- Gaps between cards and grid cells are 16px, the same as the gutter (dashboard `COL_GAP`/`ROW_GAP`, Home grids).

## Layouts (page and tools side by side)
- How the page and the tools share the room is the header's layout menu (the current layout's picture, right of the tool buttons; key `L`; palette "Layout wechseln"): Standard, Chat links, Chat + Werkzeug, Zwei Werkzeuge, Werkzeug groß, and plugins' layouts (`docs/helena-decisions/layout.md`).
- Every tool area has the same 40px header row: its tool picker (icon with a chevron) first, then the tool's own bar or its name. No tool shows twice; picking one that is already visible swaps the two.
- Nothing in a layout is re-parented: tools only change their grid column, so frames never reload. A new arrangement is a layout in the registry, never a container of its own.
- Phones: no layout menu, one thing at a time.
