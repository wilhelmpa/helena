# Decision: Start (the dashboard) as widgets

Date: 2026-09-24 · Branch: `hub/dashboard` · Status: decided (owner picked direction C)

## The job

Owner, 2026-09-24: „mache auch mal das Dashboard dann richtig schön". The old Start was one long column
of full-width groups with no hierarchy. Two failed chat answers from a switch-over sat in
"Braucht dich" for good, and the floating chat covered 40 % of the page. What was needed:

- **A calm, clear page** in the sidebar's material (ui-standard: 13/12/14 px, `--card`
  surfaces, `--accent` hover, one toolbar row).
- **One extension point.** Cards from other branches (Updates, Lokale KI, the machine) must
  plug in without anyone touching `HomePage` (§3a).
- **Per-user arrangement.** Show, hide and reorder, stored with the account.
- **"Braucht dich" that stays true.** Failures can be hidden, age out after a day, and real
  red problems of the system show up there, not only in the System tile.

## What the owner saw and chose

Three directions, rendered from a dev stack with seeded data (desktop with and without the
chat, phone, dark, a problem state; previews in `~/agent-work/plan-dashboard/previews/`):
A "Raster" (a bento grid of cards), B "Liste und Leiste" (a work column and a status rail),
**C "Kennzahlen und Heute" (chosen)**: a row of figure tiles, then sections.

The orchestrator's additions: "Zuletzt fertig" below "Läuft gerade", no greeting (only the date,
in the toolbar row), real red problems in "Braucht dich", an auto-fit tile row that wraps
(≥ 160 px per tile, 2 columns on a phone), the machine folded into the System tile (no Server
tile), per-user show/hide/reorder, all 10 languages.

## Decisions

1. **The page is a registry of widgets: the `dashboard-widget` slot of `@helena/sdk` with the
   surface `home`.** The slot existed for project dashboards (typed, unused). It now carries
   `surfaces`, `kind`, `audience`, `width`, `rows` and `hiddenByDefault`; `size` (the project
   grid) became optional. One slot for both kinds of dashboard, no second slot type.
2. **Two kinds of widget on Start.**
   - `figure`: a tile in the row at the top. It shows a value, its label, one sub-line, an
     optional progress bar or status dot. A click opens the details.
   - `section`: a framed list below, the sidebar's group in a frame. Half-width sections pair
     up in two columns on a wide screen; a full-width one stands alone.
3. **Layout by CSS only, on container queries.** The tile row is
   `grid-cols-[repeat(auto-fit,minmax(10rem,1fr))]`, 2 columns under 32 rem. Sections are
   two column stacks (first, third, … left) that become `display: contents` when narrow, so
   every section sorts back into the reader's order. No grid library: react-grid-layout
   (already used by project dashboards) and gridstack are free-drag canvases. The owner wants
   calm and consistent, and a fixed rhythm with an ordered list is exactly that.
4. **Reordering is a list, not a canvas.** "Anpassen" (the toolbar's slider icon) is a dialog
   with two sortable lists (figures, sections): dnd-kit, already a dependency, plus arrow
   buttons and the keyboard, and a switch per widget. It is stored immediately in
   `user_preference.home_dashboard`.
5. **"Braucht dich" has sources of its own** (`extensions/needsYouSources`): red problems of
   the system (`kind: 'problem'`, never hidden, first), decisions (approvals, workflow steps,
   proposals), failures (hideable, aged after 24 h into one line that links to the activity
   page). A feature adds its red problems there, not as a card.
6. **Start makes room for the floating panel.** `WorkspaceLayoutHost` sets
   `--workspace-overlay-inset` (the width of a floating panel) on the page; Start pads by it,
   other pages keep the overlay.
7. **The System tile opens a dialog with the full health overview** (`HomeSystemHealth`:
   services, engine, runs, logins with the relogin command, agents in sync, maintenance, and
   after hub/server-admin the machine). The same dialog opens from a red problem in "Braucht
   dich".

## The contract

### In the SDK (`packages/sdk/src/ui.ts`)

```ts
interface DashboardWidgetSlot extends SlotBase {   // id, label, icon?, order?
  slot: 'dashboard-widget';
  group: string;                         // "Anpassen" groups by it: 'work' | 'agents' | 'system' | a plugin's word
  surfaces?: ('home' | 'project')[];     // default ['project']; Start reads 'home'
  kind?: 'figure' | 'section';           // Start; default 'section'
  audience?: 'everyone' | 'owner';       // Start; default 'everyone' ('owner' = Administrator)
  width?: 'half' | 'full';               // a section; default 'half'
  rows?: number;                         // a section's placeholder rows (32 px) while loading; default 3
  hiddenByDefault?: boolean;             // off until the reader turns it on
  size?: { w: number; h: number; minH?: number };  // project dashboards only
  render: SlotRender<DashboardWidgetProps>;         // component (built-in) | frame (plugin)
}
```

A **plugin** declares the slot in its manifest with a frame (`render: { kind: 'frame', src }`).
Start shows its page sandboxed in a tile (80 px high) or a section (`rows × 32` px). Its id
becomes `plugin:<pluginId>:<id>`.

### In the web app (built-in widgets)

- `extensions/dashboardWidgets.ts`: the registry (`dashboardWidgets`), `homeWidget(…)` for the
  defaults, `registerDashboardWidget(widget, pluginId)`, which checks kind, width and rows.
- `extensions/homeWidgets.tsx`: **the one place a built-in widget is registered.** One import and
  one line per widget, nothing in the page.
- Building blocks, `features/home/dashboard/DashboardParts.tsx`; a widget uses these and never a
  look of its own:
  - `<FigureTile label value sub subTone status progress href|onSelect />`. `value={null}` is
    the loading placeholder. Without `href`/`onSelect` it does not look clickable.
  - `<DashboardSection label count href hrefLabel actions>` with rows from `RowList`
    (`RowLink`, `RowEmpty`, `ROW_CLASS`), `SectionSubLabel`, and `SkeletonRows count`.
- Rules:
  - A figure component may render **several** tiles (the plan limits: one per subscription),
    or **none** (`return null` while there is nothing to show, like Updates when there are
    none): the row closes the gap.
  - A section shows `SkeletonRows` while it loads, as many rows as it will show.
  - A widget that throws takes down only its own place.
- `useHomeDashboardContext()` gives a widget `owner`, the hidden failures (`dismissed`) and
  `dismiss(key, presentKeys)`.
- Default order, in gaps of 10:
  - Figures: `waiting` 10 · `agents` 20 · `tasks` 30 · `limits` 40 (owner) · `system` 50
    (owner) · `updates` 60 (owner).
  - Sections: `needs-you` 10 · `my-tasks` 20 · `running` 30 · `schedules` 40 · `projects` 50
    (full).
- Labels come from `home.widgets.<id>` (all 10 locales), or from the `label` a widget brings
  (`LocalizedText`).

### "Braucht dich" sources (`extensions/needsYouSources.ts`)

```ts
interface NeedsYouSource {
  id: string;
  order: number;   // within a kind; built-ins: system 10, server 15, security 17, approvals 20, workflow-steps 30, proposals 40, failures 50
  useEntries(ctx: { owner: boolean }): { entries: NeedsYouEntry[]; isPending: boolean };  // a hook
}
interface NeedsYouEntry {
  key: string;                      // stable: 'problem:raid:md127', 'run:34' …
  kind: 'problem' | 'approval' | 'step' | 'proposals' | 'failure';
  at: string;                       // ISO; '' if unknown
  title: string; detail: string;
  href?: string; onSelect?: () => void;   // a page, or a dialog (openSystemDetails)
  icon?: LucideIcon;
}
```

- Only **red** things are a `problem`: a service down, a login to sign in again, a degraded
  RAID, a failing disk, a failed backup or check, the thermal guard active
  (`features/server/components/serverNeedsYou.ts`), and a failed critical or high check of
  the host audit (`features/security-status/securityNeedsYou.ts`).
- Amber warnings stay in the System tile and its dialog.
- The list is read once when "Braucht dich" mounts and every hook is called in that fixed
  order. So a source registers when `extensions/homeWidgets` loads, never later.

### Per-user arrangement

`user_preference.home_dashboard` (jsonb, migration `helena_home_dashboard`), in
`GET/PATCH /account/preferences` as `homeDashboard`:

```ts
{ order: string[]; hidden: string[]; shown: string[]; dismissed: string[] }
```

- `order` holds widget ids.
- `hidden` holds widgets that are on by default and turned off; `shown` holds widgets that are
  off by default and turned on.
- `dismissed` holds the keys of hidden failures, pruned to those still reported and capped at
  200.
- A widget the reader never placed goes right after the widget it follows by default
  (`layout.ts`, `arrange`).

## Example: a figure tile (Lokale KI)

```tsx
// features/local-ai/components/LocalAiTile.tsx
export default function LocalAiTile() {
  const t = useTranslations('localAi');
  const status = useLocalAiStatus();                 // the feature's own query
  if (!status.data?.installed) return null;          // only shown once installed
  const on = status.data.enabled;
  return (
    <FigureTile
      label={t('title')}                             // "Lokale KI"
      value={on ? t('on') : t('off')}                // "An" / "Aus"
      status={on ? 'running' : undefined}
      progress={on ? { percent: status.data.load, className: 'bg-status-running' } : null}
      sub={on ? t('load', { percent: status.data.load }) : t('offHint')}
      onSelect={openLocalAiCard}                     // its card with the switches, incl. "Jev (experimentell)"
    />
  );
}

// extensions/homeWidgets.tsx: one line
homeWidget({ id: 'local-ai', kind: 'figure', group: 'system', order: 55, audience: 'owner', component: LocalAiTile }),
```

## Example: a section

```tsx
// features/notes/components/RecentNotesSection.tsx
export default function RecentNotesSection() {
  const t = useTranslations('notes');
  const notes = useRecentNotes(5);
  return (
    <DashboardSection label={t('recent')} count={notes.data?.length} href="/docs" hrefLabel={t('all')}>
      {notes.isPending ? (
        <SkeletonRows count={5} />
      ) : notes.data!.length === 0 ? (
        <RowEmpty icon={<NotebookText />}>{t('none')}</RowEmpty>
      ) : (
        notes.data!.map((note) => (
          <RowLink key={note.id} href={note.href} icon={<NotebookText />} title={note.title} detail={note.folder} />
        ))
      )}
    </DashboardSection>
  );
}

// extensions/homeWidgets.tsx
homeWidget({ id: 'recent-notes', kind: 'section', group: 'work', order: 45, rows: 5, component: RecentNotesSection, hiddenByDefault: true }),
```

A red problem of a feature is a source, not a card (the real one: `features/server/components/serverNeedsYou.ts`):

```ts
needsYouSources.register({
  id: 'server', order: 15,
  useEntries: ({ owner }) => {
    const overview = useServerOverview(owner);
    return { isPending: false, entries: redItems(overview.data).map((item) => ({
      key: `problem:${item.id}`, kind: 'problem', at: item.since ?? '',
      title: message(item), detail: '', href: serverPath(tabOf(item.id)), icon: Server })) };
  },
}, 'helena.home');
```

## Rejected

| Option | Why not |
|---|---|
| Directions A (bento cards) and B (work column + rail) | Not chosen by the owner. |
| A new slot type `home-card` | `dashboard-widget` already exists in the SDK; one slot with a surface keeps project dashboards and Start on one contract. |
| react-grid-layout / gridstack (free drag and resize) | A canvas invites "wild"; the owner wants one calm rhythm. Order and visibility are what a reader changes. |
| A Server tile of its own | The machine is part of "does everything run" (the System tile); red problems go into "Braucht dich". |
| Hidden failures in the browser (localStorage) | They would come back on every other device. They live in the account preference, capped and pruned. |
| Deleting failures from the activity log to clear Start | The log is history. Start only stops showing them. |
