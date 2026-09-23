# DESIGN.md

Design tokens and principles for the Volition web app (`apps/web`). Extracted from
the established system in `apps/web/src/app/globals.css` (Tailwind v4 `@theme` +
`:root`/`.dark` OKLCH variables). Those CSS variables are the source of truth; this
file mirrors them. When a token changes in `globals.css`, update it here in the same
change.

## Direction

Calm, product-grade UI: warm neutral surfaces, one restrained accent, borderless-first
layout, hierarchy carried by type weight, spacing, and subtle background shifts rather
than boxes and lines. Quiet and dense, not decorated. This is an **app/tool** register —
clarity over cleverness; no decoration that does not aid comprehension.

## Brand

- **Name:** Volition. `APP_NAME` in `apps/web/src/utils/app.ts` is the one place the web
  app reads it from.
- **Monogram:** a lowercase v in a rounded square (`components/brand/VolitionMark.tsx`,
  `app/icon.svg`). The v's right arm is a little taller, so it also reads as a check.
- **Wordmark:** "volition" drawn as monoline paths with round caps
  (`components/brand/VolitionWordmark.tsx`), so it needs no font.
- **Accent (`brand`):** petrol blue, `#0e6f81` in light and `#62becd` in dark. It is
  clearly apart from the red, amber and green of the status colours, so it never reads
  as a state, and a cool accent on warm neutrals stays quiet. It marks focus, links,
  mentions, the selection, checked switches and checkboxes, and the selected card.
  Buttons stay `primary`.

## Tokens (intent-named; values live in `globals.css`)

Colors are OKLCH ramps of warm neutrals (hue 60–85, chroma under 0.012); no surface sits
on pure white or pure black. Light is a warm off-white canvas (`#fbfaf7`) with a slightly
darker, tinted sidebar; dark is a warm charcoal (`#23201e`), not blue-black. Light and
dark are both first-class (`.dark` class toggles; the app ships a theme switch).

- `background` / `foreground` — page base and primary text.
- `card` / `card-foreground` — a raised surface (modals, popovers, kanban detail).
  Only a few percent off `background`; use a background shift, not a border, to raise.
- `muted` / `muted-foreground` — quiet fills and secondary text.
- `secondary` — the active/selected chip fill (tabs, toggles).
- `accent` / `accent-foreground` — hover fill for interactive rows/buttons.
- `border` — hairline; in dark it is `white / 10%`, i.e. a tint, never flat gray.
- `primary` — high-contrast solid (primary buttons); warm near-black in light, warm
  near-white in dark.
- `brand` / `brand-foreground` — the one accent; see Brand.
- `destructive` — error / overdue / delete only. It serves two roles at once: `text-destructive`
  on the page, and a fill under the `destructive-foreground` label of a destructive button
  or badge. That label is white in light and near-black in dark, where the lighter red
  would not hold white text at AA.
- `success` — a finished or healthy state (toasts, the update dot).
- `warning` — a state that needs attention but has refused nothing, where `destructive` would
  overstate it: a soft WIP limit is at its maximum while a hard one has blocked the move. Text
  and low-opacity tint only; there is no warning button, so it is tuned for the page background
  alone. An amber rather than a bright yellow — yellow at a legible chroma has to drop this far
  in lightness to hold contrast against the light page.
- `ring` — focus ring (keyboard a11y), the brand colour at half strength.
- `chart-1…5` — a warm neutral ramp for charts. For categorical series that need
  to be told apart (priority, assignee), widgets use their own small hue palette; for
  entity series (status, type) the entity's own color is used.
- `priority-low|medium|high|urgent` — fixed hues for the priority field.
- `sidebar-*` — the app sidebar surface (slightly off the page background).
- Tailwind's `amber/emerald/red/sky/blue-500` are redefined with less chroma, since
  features use them directly for status dots and tints.

## Scale & shape

- **Type:** Inter Variable (`--font-sans`, also `--font-heading`). Weight and size carry
  hierarchy — do not add display faces. UI text is 13–14px (sidebar rows 13px), page
  titles 20px semibold, section labels 11–12px muted in sentence case. Counts, dates and
  keys take `tabular-nums` where they are set; it is not global, because Inter's tabular
  set also widens the hyphen.
- **Line-height:** the `--text-*--line-height` tokens in `globals.css` replace Tailwind's
  defaults, which are tuned for 16px prose and leave `text-xs`/`text-sm` cramped. Body sizes
  run 1.5–1.6; headings tighten as they grow (1.25 at `2xl` down to 1.1 at `4xl`) and take
  negative tracking from `2xl` up.
- **Radius:** base `--radius: 0.625rem`; scale `sm .6 · md .8 · lg 1 · xl 1.4 · 2xl 1.8`.
  Controls use `md` (8px), overlays and cards `lg` (10px), items inside a menu `sm`.
  Keep `padding ≥ radius`.
- **Spacing:** 4px scale (Tailwind's `--spacing`). Proximity encodes relationship: inside a
  group < between groups < between sections.
- **Shadows:** only overlays (menus, popovers, tooltips, toasts, dialogs, sheets) cast one;
  `shadow-xs` is empty and cards are flat.

## Principles

- **Borderless first.** Separate surfaces by whitespace → background shift → soft
  elevation, in that order. Add a hairline `border` only when those fail, and never a
  flat gray box around every block. No card-in-card. No decorative left-accent strip.
- **One focal point per view; one accent per action.** Reserve `primary` for the single
  main action; secondary actions are ghost/outline.
- **Depth over lines.** Raise a surface with a 3–5% background shift and a soft shadow,
  not a 1px border.
- **Contrast is measured, not eyeballed** — WCAG 2 ratios, AA at least. Light: foreground
  16.2, muted text 5.8 on the page and 4.8 on the sidebar's active pill, brand 5.6,
  destructive 5.5 (its label 5.6), warning 4.8. Dark: foreground 13.4, muted text 7.3
  (5.8 on a hover fill), brand 7.5, destructive 5.7 (its label 6.4), warning 8.6. Hairline borders are
  decorative and sit below 3:1; the focus ring does not.
- **Motion is restrained.** Hover 120–150ms (`--default-transition-duration` is 140ms),
  entrance 250–400ms; animate only `transform`/`opacity`/colours; honor
  `prefers-reduced-motion`.

## Settings pages (account, project, god)

A settings page is a centered measure of stacked groups: a small heading with an optional
one-line explanation, then its rows, groups separated by space and a hairline rule — no box
around a group and no card per row. A row puts its name and explanation on the left and its
control in a fixed-width column on the right, so every control on the page lines up; below
`sm` the control drops under the text. A page whose changes save on the spot reports that in
the header (saving, then saved) rather than freezing its controls.

## Dashboards section (full-width, borderless)

The analytics dashboards render edge-to-edge inside the app shell: a full-width content
column (comfortable side padding, no narrow centered measure), widgets laid out on a
12-column grid, each widget a borderless section — a quiet header (title + its own
controls) over the body, separated from neighbors by space and a hairline divider under
the header, not by a card. Full-bleed widgets (stat strip, pulse) break the two-column
rhythm so the page is not one repeated shape.
