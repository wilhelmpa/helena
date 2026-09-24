import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nextJsConfig } from '@repo/eslint-config/next';
import i18nJson from 'eslint-plugin-i18n-json';
import betterTailwindcss from 'eslint-plugin-better-tailwindcss';

// English is the source language, so every locale is compared against the same
// namespace in `messages/en`. The comparison rules take one reference file each, so
// there is one config block per namespace rather than one for the whole folder.
const messagesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'messages');
const namespaces = fs.readdirSync(path.join(messagesDir, 'en'));

// The rules below only see files that exist, so a namespace a language does not
// carry at all would pass unnoticed. It fails here instead.
for (const locale of fs.readdirSync(messagesDir)) {
  const missing = namespaces.filter((ns) => !fs.existsSync(path.join(messagesDir, locale, ns)));
  if (missing.length > 0) throw new Error(`messages/${locale} is missing: ${missing.join(', ')}`);
}

const jsonProcessor = { meta: { name: '.json' }, ...i18nJson.processors['.json'] };

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...nextJsConfig,
  // The app is also used over plain http on the LAN, where both APIs are undefined and
  // a direct call throws. The helpers fall back to what every context provides.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/utils/uuid.ts', 'src/utils/clipboard.ts', 'src/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'crypto', property: 'randomUUID', message: 'Use uuid() from @/utils/uuid.' },
        {
          object: 'navigator',
          property: 'clipboard',
          message: 'Use copyText/readClipboardText from @/utils/clipboard.',
        },
      ],
    },
  },
  // Every rule below is an error. What the code base already had when a rule arrived is
  // listed in eslint-suppressions.json (ESLint's bulk suppressions): those places pass,
  // anything new fails. Fixing one fails too until the list is pruned
  // (`bunx eslint --prune-suppressions .` here), so the list only shrinks.
  //
  // Tailwind classes, read by eslint-plugin-better-tailwindcss from the app's own
  // Tailwind entry: start/end instead of left/right (the interface also runs right to
  // left, AGENTS.md), and the design system's restrictions below.
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'better-tailwindcss': betterTailwindcss },
    settings: { 'better-tailwindcss': { entryPoint: 'src/app/globals.css' } },
    rules: {
      // The inline axis only (left/right, which flip right to left). The block axis and
      // sizes (top, mt, h-, w-, size-) do not change with the text direction, and the
      // interface has no vertical writing mode.
      'better-tailwindcss/enforce-logical-properties': [
        'error',
        {
          ignore: [
            '^(?:[^:\\s]+:)*!?-?(?:scroll-)?[pm][tb]-',
            '^(?:[^:\\s]+:)*!?-?(?:top|bottom)-',
            '^(?:[^:\\s]+:)*!?border-[tb](?:-|$)',
            '^(?:[^:\\s]+:)*!?(?:min-|max-)?[wh]-',
            '^(?:[^:\\s]+:)*!?size-',
          ],
        },
      ],
    },
  },
  // Text a person reads comes from the message files (next-intl), in all ten languages,
  // never from a string in the JSX. Punctuation and symbols between messages are fine.
  {
    files: ['src/**/*.tsx'],
    ignores: ['src/**/*.test.tsx'],
    rules: {
      'react/jsx-no-literals': [
        'error',
        {
          allowedStrings: [
            '·',
            '—',
            '–',
            '…',
            '/',
            '|',
            ':',
            '(',
            ')',
            '-',
            '+',
            '×',
            '•',
            '→',
            '←',
            '↑',
            '↓',
            '%',
            '#',
            '@',
            '*',
            '?',
            '!',
            ',',
            '.',
            '"',
            "'",
            '›',
            '‹',
            '&',
            '=',
            '<',
            '>',
          ],
        },
      ],
    },
  },
  // The sidebar is the reference for every surface in the app
  // (docs/volition-design-helena-ui.md): a page never invents its own color or size.
  // `src/components/ui` and `src/components/common` are the building blocks that
  // *define* the tokens and the handful of deliberate pixel values the design calls
  // for (PageBody's 720/1080 content widths, for example); everything built out of
  // them — every feature and every route — uses only the tokens.
  {
    files: ['src/features/**/*.{ts,tsx}', 'src/app/**/*.{ts,tsx}'],
    ignores: [
      'src/**/*.test.{ts,tsx}',
      // Content color, not chrome: these hexes are a palette the *user* picks from
      // (a label/field color, a sticky note, an annotation stroke) or a fallback for
      // one (a deleted column's color), not a developer's ad hoc UI choice. A sticky
      // note also keeps fixed dark text on its own fixed pastel background by design
      // ("Miro-style"), independent of the app's light/dark theme.
      'src/features/settings/components/crud/SettingsColorField.tsx',
      'src/features/notes/utils/stickerColors.ts',
      'src/features/notes/components/StickerNode.tsx',
      'src/features/issue/utils/annotations.ts',
      'src/features/issue/utils/timeline.ts',
    ],
    plugins: { 'better-tailwindcss': betterTailwindcss },
    settings: { 'better-tailwindcss': { entryPoint: 'src/app/globals.css' } },
    rules: {
      // Class names, whatever their variants (hover:, md:, dark:, …).
      'better-tailwindcss/no-restricted-classes': [
        'error',
        {
          restrict: [
            {
              pattern:
                '^(?:[^:\\s]+:)*!?(?:bg|text|border|ring|fill|stroke|from|via|to|divide|outline|accent|caret|decoration|shadow|placeholder)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-[0-9]{2,3}(?:/[0-9]+)?$',
              message:
                'No raw Tailwind palette classes here (bg-blue-500, text-gray-400, …) — use a token instead. See docs/volition-design-helena-ui.md.',
            },
            {
              // Scoped to the type scale and the row/control height it drives (the two
              // cases the design doc gives, `text-[13px]` and `h-[37px]`) — not every
              // arbitrary bracket value. A truncation width like `max-w-[220px]` is
              // content-specific, not part of a scale, and is not what this rule is for.
              pattern:
                '^(?:[^:\\s]+:)*!?(?:text|leading|h|size)-\\[[0-9]+(?:\\.[0-9]+)?(?:px|r?em)\\]$',
              message:
                'No arbitrary text size or row/control height here (text-[13px], h-[37px], …) — that scale lives in components/ui and components/common only. See docs/volition-design-helena-ui.md.',
            },
            {
              // The one type scale (globals.css): 12 xs · 13 sm (the sidebar's row text,
              // the standard) · 14 md · 16 base · 20 xl · 24 2xl · 30 3xl, in regular,
              // medium and semibold. 18px (text-lg), anything from 36px up, and the
              // thin/light/bold/black weights are off it.
              pattern:
                '^(?:[^:\\s]+:)*!?(?:text-(?:lg|[4-9]xl)|font-(?:thin|extralight|light|bold|extrabold|black))$',
              message:
                'Off the type scale — use text-xs/sm/md/base/xl/2xl/3xl and font-normal/medium/semibold. See the scale in globals.css.',
            },
          ],
        },
      ],
      // Raw colors outside class names too (style objects, SVG attributes).
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'Literal[value=/#[0-9a-fA-F]{3,8}\\b|\\brgba?\\(/], TemplateElement[value.raw=/#[0-9a-fA-F]{3,8}\\b|\\brgba?\\(/]',
          message:
            'No raw hex/rgb() colors here — use a token (bg-accent, text-muted-foreground, --status-*, --brand, …). See docs/volition-design-helena-ui.md.',
        },
      ],
    },
  },
  ...namespaces.map((namespace) => ({
    files: [`messages/*/${namespace}`],
    plugins: { 'i18n-json': i18nJson },
    processor: jsonProcessor,
    rules: {
      'i18n-json/valid-json': 'error',
      'i18n-json/valid-message-syntax': ['error', { syntax: 'icu' }],
      // A key added to English without the same key in every other language, or one
      // left behind in a single language, fails the lint.
      'i18n-json/identical-keys': ['error', { filePath: path.join(messagesDir, 'en', namespace) }],
      // identical-placeholders stays off: it compares the plural categories of a
      // message too, and those differ by language by design (zh has only `other`,
      // ru and uk have `few` and `many` where English has `one`).
    },
  })),
];
