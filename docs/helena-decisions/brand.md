# Decision: Helena's logo, type and brand files

Date: 2026-09-24 · Branch: `hub/brand` · Status: decided (owner: variant A "Fackel", type T1 Inter)

## The job

The owner asked for "ein cooles Logo im Style von Hermes und schöne Typo". Helena runs on
Hermes Agent (Nous Research) as its only external runtime, so the two brands should read as
siblings. The brand has to work in the app (sidebar open and collapsed, sign-in, About, the
public share header, light and dark, phones), as favicon and app icons, in mails and on
GitHub, and it has to keep the owner's type sizes (13/12/14/16 px,
`docs/volition/ui-standard.md`).

## What Hermes' brand is (read from its sources on Kingston)

- The wordmark is **figlet's "ANSI Shadow" font**: HERMES-AGENT as six text rows of `█` blocks
  and double box-drawing lines (`╗ ║ ╝ ╚ ╔ ═`) for a shadow down and to the right
  (`ui-tui/src/banner.ts`, `hermes_cli/banner.py`). The rows are coloured in three bands, two
  rows each: gold `#FFD700`, amber `#FFBF00`, bronze `#CD7F32` (`LOGO_GRADIENT = [0,0,1,1,2,2]`).
  `assets/banner.png` is that text rendered on `#141414`.
- The website sets DM Sans/Inter for text, JetBrains Mono for code, gold `#FFD700` in dark
  mode and `#8B6508` in light mode.
- The favicon is the caduceus emoji `☤` as SVG text; the hero art is a braille caduceus.

## What the owner saw and chose

Three variants and two type options, each as an overview sheet and as captures from a dev
instance (sidebar open/collapsed, sign-in, favicon tab strip, phone, light and dark):

- **A "Fackel" — chosen.** Helena's torch as a pixel mark (Hermes carries the caduceus, Helena
  the torch; "Helena" means the bright one) and HELENA in the same ANSI Shadow lettering as
  HERMES-AGENT, banded, with the double-line shadow.
- B "Monogramm": a pixel H and HELENA as plain blocks in the text colour. Calmer, but the
  mark duplicated the wordmark's first letter.
- C "Funke": the previous mark's idea (two pillars joined by a spark) in pixels, with
  "Helena" set in DM Sans.
- **T1: Inter stays the UI face — chosen**, JetBrains Mono becomes the code face. T2 (DM Sans
  for the UI) was the alternative.

The unchosen variants are gone from the code; the sheets stay with the branch's previews.

## Decisions

1. **One brand source, `@helena/brand` (packages/brand).** The palette, the art as data, and
   renderers for the web components, the static files and the mail header. Every place that
   shows the brand reads it; a rebrand is a change there plus `build:assets`.
2. **The wordmark is Hermes' own lettering.** HELENA set in ANSI Shadow, drawn from the
   character grid as rectangles: blocks for `█`, the terminal's line segments for each
   box-drawing character. On a 6 × 14 unit cell with line width 1 and gap 3 every edge falls
   on a whole unit, so the full wordmark (300 × 84) is crisp at 1 unit = 1 device pixel; the
   compact one (3 × 7 cell, one shadow line, 150 × 42 units, shown 75 × 21 px) is crisp on
   2× screens. Only the six rendered rows are in the repo, as Hermes (MIT) has them; no font
   file is shipped.
3. **The mark is 16 × 16 pixel art** on Hermes' ink tile, crisp at 16/24/32/48 px without
   hinting; from 64 px up it carries the ANSI shadow as two hairline echoes of the outline. The
   tile is ink in both themes, so the art keeps Hermes' colours everywhere.
4. **Light theme:** the wordmark's bands darken to `#9A7000` / `#A85A00` / `#8A4516`
   (3.97–6.84 : 1 on the page and the sidebar; Hermes' gold would be 1.3 : 1). Brand surfaces
   that stay dark in both themes (tile, sign-in panel, About header) use `--helena-ink`.
5. **Icon files are rasterised in-process with resvg** (`@resvg/resvg-js`, MPL-2.0, dev
   dependency of the package): favicon SVG + ICO (16/32/48 PNG inside), 192/512, apple-touch
   180 and maskable 512 with the art inside the 80 % safe zone. The output is byte-identical
   on macOS and Linux. The social preview carries live type and is a browser screenshot of
   `social-preview.svg`.
6. **JetBrains Mono** comes from Fontsource's variable package
   (`@fontsource-variable/jetbrains-mono`, OFL-1.1), imported in `globals.css` the way Inter
   comes from `inter-ui`: bundled by Next, served from the instance, no Google CDN.
7. **Mail header as text.** The ANSI rows in a monospace `<pre>` on an ink bar, coloured per
   row. Every mail font has the block and box-drawing characters.
8. **About.** "Über Helena" in the account menu opens a dialog with the brand on the ink, what
   Helena is, what it runs on, and the AGPL fork attribution (it replaces the bare
   attribution link that sat in the menu). No version, as the owner wants.

## Rejected

| Option | Why not |
|---|---|
| Variants B and C, DM Sans for the UI | Not chosen by the owner (see above). |
| A pixel webfont (Press Start 2P, Silkscreen; OFL) for the wordmark | Not Hermes' lettering; a font load for six letters; renders differently per platform. |
| Tracing `banner.png` | Raster source, blurry at other sizes; the text rows are the real source. |
| `sharp` for the icons | libvips native binary (LGPL parts), far heavier than a few icons need. |
| Chrome/Playwright or ImageMagick for the icons | An external binary or a system package; resvg runs in-process. |
| `next/font/google` | Downloads from Google at build time; Fontsource is the same files as a locked npm dependency. |
| Copying woff2 files into the repo | The same files as the npm package, without updates or the licence file next to them. |
| SVG or a hosted PNG in mails | Gmail drops SVG; a LAN instance has no public image URL and clients block remote images; CID images show as attachments in some clients. |

## Licences

| Component | Licence |
|---|---|
| JetBrains Mono (font) | SIL OFL 1.1 |
| Fontsource packaging | MIT |
| `@resvg/resvg-js` (dev only) | MPL-2.0 |
| ANSI Shadow rows | figlet font output, as used by Hermes Agent (MIT) |

## Open

- GitHub: upload `apps/web/public/brand/social-preview.png` as the repository's social preview
  at the public cut (repo settings; it is not read from the tree).
- A trademark check for "Helena" is already on the release list.
