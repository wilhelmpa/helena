# Decision: Helena's logo, type and brand files

Date: 2026-09-24 · Branch: `hub/brand` · Status: built; the owner picks the variant

## The job

The owner asked for "ein cooles Logo im Style von Hermes und schöne Typo". Helena runs on
Hermes Agent (Nous Research) as its only external runtime, so the two brands should read as
siblings. The brand has to work in the app (sidebar open and collapsed, sign-in, the public share
header, light and dark, phones), as favicon and app icons, in mails and on GitHub, and it has to
keep the owner's type sizes (13/12/14/16 px, `docs/volition/ui-standard.md`).

## What Hermes' brand is (read from its sources on Kingston)

- The wordmark is **figlet's "ANSI Shadow" font**: HERMES-AGENT as six text rows of `█` blocks and
  double box-drawing lines (`╗ ║ ╝ ╚ ╔ ═`) for a shadow down and to the right
  (`ui-tui/src/banner.ts`, `hermes_cli/banner.py`). The rows are coloured in three bands, two rows
  each: gold `#FFD700`, amber `#FFBF00`, bronze `#CD7F32` (`LOGO_GRADIENT = [0,0,1,1,2,2]`).
  `assets/banner.png` is that text rendered on `#141414`.
- Accents: `#B8860B` (dim), `#FFF8DC` (text). The website sets DM Sans/Inter for text,
  JetBrains Mono for code, gold `#FFD700` in dark mode and `#8B6508` in light mode.
- The favicon is the caduceus emoji `☤` as SVG text; the hero art is a braille caduceus.

## Decisions

1. **One brand source, `@helena/brand` (packages/brand).** The variant switch (`BRAND_VARIANT`,
   `BRAND_UI_FONT` in `src/config.ts`), the palette, the art as data, and renderers for the web
   components, the static files and the mail header. Every place that shows the brand reads it,
   so a rebrand or the owner's pick is one constant plus `build:assets`. The package is the extension
   point: a new variant is one entry in `art.ts` and the rest follows.
2. **The wordmark is Hermes' own lettering.** HELENA set in ANSI Shadow, drawn from the character
   grid as rectangles: blocks for `█`, the terminal's line segments for each box-drawing
   character. On a 6 × 14 unit cell with line width 1 and gap 3 every edge falls on a whole unit, so
   the full wordmark (300 × 84) is crisp at 1 unit = 1 device pixel; the compact one (3 × 7 cell,
   one shadow line, 150 × 42 units, shown 75 × 21 px) is crisp on 2× screens. Only the six rendered
   rows are in the repo, as Hermes (MIT) has them; no font file is shipped.
3. **Marks are 16 × 16 pixel art** on Hermes' ink tile, crisp at 16/24/32/48 px without hinting;
   from 64 px up they carry the ANSI shadow as two hairline echoes of the outline. The tile is ink
   in both themes, so the art keeps Hermes' colours everywhere.
4. **Light theme:** the bands darken to `#9A7000` / `#A85A00` / `#8A4516` (3.97–6.84 : 1 on the
   page and the sidebar; Hermes' gold would be 1.3 : 1). Brand surfaces that stay dark in both
   themes (tile, sign-in panel) use `--helena-ink`.
5. **Icon files are rasterised in-process with resvg** (`@resvg/resvg-js`, MPL-2.0, dev dependency of
   the package): favicon SVG + ICO (16/32/48 PNG inside), 192/512, apple-touch 180 and maskable 512
   with the art inside the 80 % safe zone.
6. **Fonts come from Fontsource's variable packages** (`@fontsource-variable/jetbrains-mono`,
   `@fontsource-variable/dm-sans`; the fonts are OFL-1.1), imported in `globals.css` the way Inter
   already comes from `inter-ui`. Bundled by Next and served from the instance; no Google CDN at
   runtime or build time. A face downloads only when the page uses it.
7. **Type recommendation: Inter stays the UI face** (its tall x-height and cv05/cv08 carry the
   12–14 px UI; the owner made it the standard), **JetBrains Mono becomes the code face** for IDs, keys,
   code and terminal output (the same face on every device instead of `ui-monospace`, and Hermes'
   code face). The brand's display type is the pixel wordmark itself. DM Sans stays available
   through `BRAND_UI_FONT = 'dm-sans'` and is the wordmark face of variant C.
8. **Mail header as text.** The ANSI rows in a monospace `<pre>` on an ink bar, coloured per row.
   Every mail font has the block and box-drawing characters.

## Rejected

| Option | Why not |
|---|---|
| A pixel webfont (Press Start 2P, Silkscreen; OFL) for the wordmark | Not Hermes' lettering; a font load for six letters; it renders differently per platform. |
| Tracing `banner.png` | Raster source, blurry at other sizes; the text rows are the real source. |
| `sharp` for the icons | libvips native binary (LGPL parts) and far heavier than needed for a few icons. |
| Chrome/Playwright or ImageMagick for the icons | An external binary or a system package; resvg runs in-process. |
| `next/font/google` | Downloads from Google at build time (network in the build, a second pinning path); Fontsource is the same files as a locked npm dependency. |
| Copying woff2 files into the repo | The same files as the npm packages, without updates or the licence file next to them. |
| SVG or a hosted PNG in mails | Gmail drops SVG; a LAN instance has no public image URL and clients block remote images; CID images show as attachments in some clients. |
| DM Sans as the UI face (T2) | Smaller x-height; at 13 px it reads lighter and tighter than Inter, and the owner fixed Inter as the standard. Shown to the owner as the alternative. |

## Licences

| Component | Licence |
|---|---|
| JetBrains Mono, DM Sans (fonts) | SIL OFL 1.1 |
| Fontsource packaging | MIT |
| `@resvg/resvg-js` (dev only) | MPL-2.0 |
| ANSI Shadow rows | figlet font output, as used by Hermes Agent (MIT) |

## Open

- The owner's pick (A fackel recommended, B monogramm, C funke) and T1/T2. After it: delete the
  other variants' folders in `public/brand/`, their art in `art.ts`/`pixel.ts`, and
  `@fontsource-variable/dm-sans` unless T2 or C was chosen.
- Variant C's wordmark is live text in DM Sans; as a standalone SVG file it needs converting to
  outlines if C is chosen.
- A trademark check for "Helena" is already on the release list.
