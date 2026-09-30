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

// The UI framework's style rules (docs/ui-framework.md). Radii: only the five steps of
// tokens.css (sm chips/badges · md buttons/fields · lg cards/rows/menus · xl panels/dialogs
// · full pills), everywhere in the app — no rounded, rounded-xs, rounded-2xl…, no
// rounded-[…].
const RADIUS_STEPS_ONLY = {
  pattern:
    '^(?:[^:\\s]+:)*!?rounded(?:-(?:[trbl]|tl|tr|bl|br|s|e|ss|se|es|ee))?(?:-(?:xs|[2-4]xl|\\[[^\\]]+\\]))?$',
  message:
    'Only the radius steps rounded-sm/md/lg/xl/full (tokens.css). See docs/ui-framework.md §Radien.',
};
// Pages and features build from the framework's components: no Tailwind classes of their
// own for spacing, type size or radius (owner 28.09.: "keine eigenen Styles"). Place
// things with Stack/Inline/Grid/Box, write text with Text, take radii from the
// components. What a component lacks becomes a variant of it, not an inline class.
const FRAMEWORK_ONLY = [
  {
    pattern:
      '^(?:[^:\\s]+:)*!?-?(?:p|px|py|pt|pb|ps|pe|pl|pr|m|mx|my|mt|mb|ms|me|ml|mr|gap|gap-x|gap-y|space-x|space-y)-(?:[0-9]+(?:\\.5)?|px)$',
    message:
      'No spacing classes in pages and features — use Stack, Inline, Grid or Box from @/design-system (docs/ui-framework.md §Abstände).',
  },
  {
    // A box is the design system's Card / ListBox (owner 30.09.: "gleiche Boxen"): surface, frame,
    // shadow and padding come from it, never from a page's own classes (docs/ui-framework.md §19).
    pattern: '^(?:[^:\\s]+:)*!?(?:bg-card|bg-popover|border|shadow|shadow-(?:xs|sm|md|lg|xl|2xl))$',
    message:
      'No hand-drawn box in pages and features - use Card, ListBox, TableCard or SettingsGroup from @/design-system (docs/ui-framework.md §19).',
  },
  {
    pattern: '^(?:[^:\\s]+:)*!?text-(?:xs|sm|md|base|xl|2xl|3xl)$',
    message:
      'No type-size classes in pages and features — use Text from @/design-system (docs/ui-framework.md §Schrift).',
  },
  {
    pattern:
      '^(?:[^:\\s]+:)*!?rounded(?:-(?:[trbl]|tl|tr|bl|br|s|e|ss|se|es|ee))?-(?:sm|md|lg|xl)$',
    message:
      'No radius classes in pages and features — the component carries its radius (docs/ui-framework.md §Radien).',
  },
];

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
  // dnd-kit's own DndContext announces drags to screen readers in English. The wrapper
  // speaks the interface's language.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/components/common/dnd/DndContext.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@dnd-kit/core',
              importNames: ['DndContext'],
              message: 'Use DndContext from @/components/common/dnd/DndContext.',
            },
          ],
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
  // Radii everywhere (framework rule, docs/ui-framework.md §Radien).
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/**/*.test.{ts,tsx}'],
    plugins: { 'better-tailwindcss': betterTailwindcss },
    settings: { 'better-tailwindcss': { entryPoint: 'src/app/globals.css' } },
    rules: {
      'better-tailwindcss/no-restricted-classes': ['error', { restrict: [RADIUS_STEPS_ONLY] }],
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
              // docs/design-system.md: no arbitrary values in features and routes — sizes,
              // spacing and colours come from the design system (@/design-system,
              // tokens.css). p-[12px], bg-[#111], w-[372px], text-[var(--x)] …
              pattern: '^(?:[^:\\s]+:)*!?-?[a-z][a-z0-9-]*-\\[[^\\]]+\\](?:/[0-9]+)?$',
              message:
                'No arbitrary Tailwind values here — use a design-system building block or token (docs/design-system.md).',
            },
            RADIUS_STEPS_ONLY,
            ...FRAMEWORK_ONLY,
            {
              // A page has no container width of its own: PageBody is full width, reading
              // text is centred by PageBody reading (docs/design-system.md §3).
              pattern: '^(?:[^:\\s]+:)*!?max-w-(?:screen(?:-[a-z0-9]+)?|prose|[2-7]xl)$',
              message:
                'No own max-w container here — pages use PageBody (docs/design-system.md §3).',
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
      // Menus, popovers and tooltips come from the design system (one menu building
      // block: portal, collision, max height — docs/design-system.md §4).
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@dnd-kit/core',
              importNames: ['DndContext'],
              message: 'Use DndContext from @/components/common/dnd/DndContext.',
            },
            ...['dropdown-menu', 'context-menu', 'popover', 'tooltip', 'card'].map((name) => ({
              name: `@/components/ui/${name}`,
              message:
                'Import this building block from @/design-system (docs/design-system.md §4).',
            })),
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
