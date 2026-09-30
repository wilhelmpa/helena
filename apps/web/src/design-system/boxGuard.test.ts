import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

// One box for the whole content (owner 30.09.: "gleiche Boxen", docs/ui-framework.md §19). The
// card is drawn by the design system only; nothing else in the app may draw another one. ESLint
// (better-tailwindcss/no-restricted-classes) keeps `bg-card`, `border` and `shadow-*` out of pages and
// features; this test covers what it does not see: CSS files and the duplicated building blocks.

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..');

function files(dir: string, ext: RegExp): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...files(path, ext));
    else if (ext.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}
const read = (path: string) => readFileSync(join(srcDir, path), 'utf8');

describe('one box', () => {
  // Dark: a wide soft shadow on a dark page is a black smear under every box (owner 30.09.: "unter
  // den Elementen ein langer Schatten ... im Dark Mode"). The dark card shadow stays tight.
  it('the dark card shadow is tight (no long shadow under boxes)', () => {
    const tokens = read('design-system/tokens.css');
    const dark = tokens.slice(tokens.lastIndexOf('--shadow-card:'));
    const value = /--shadow-card:([^;]+);/.exec(dark)![1]!;
    for (const layer of value.split(/,(?![^(]*\))/)) {
      const [, y = '0px', blur = '0px'] = layer.trim().split(/\s+/);
      assert.ok(
        parseFloat(y) <= 2 && parseFloat(blur) <= 4,
        `dark --shadow-card layer too wide: ${layer.trim()}`,
      );
    }
  });

  it('no stylesheet outside the design system draws a card', () => {
    const wrong: string[] = [];
    for (const file of files(srcDir, /\.css$/)) {
      const rel = relative(srcDir, file);
      // The shadcn primitives' and the board's own surfaces in globals.css are the generated
      // building blocks (`data-slot='card'`, the kanban card); every other rule is a page's own.
      if (rel.startsWith('design-system/') || rel === 'app/globals.css') continue;
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/box-shadow:\s*var\(--shadow-card\)/g))
        wrong.push(`${rel}: ${match[0]}`);
    }
    assert.deepEqual(wrong, []);
  });

  it('the dashboard has no card, label or meta of its own', () => {
    const primitives = read('components/helena/DashboardPrimitives.tsx');
    assert.match(primitives, /export \{ Card \} from '@\/design-system\/components\/Card'/);
    assert.match(primitives, /export \{ MonoLabel, MonoMeta \} from/);
    const css = read('components/helena/DashboardPrimitives.module.css');
    for (const rule of ['.card', '.raised', '.selected', '.label', '.meta'])
      assert.equal(css.includes(`\n${rule} {`), false, `${rule} is the design system's`);
    assert.equal(css.includes('var(--radius-xl)'), false, 'a tile has the box radius');
  });

  it('the box tokens exist and the box uses them', () => {
    const tokens = read('design-system/tokens.css');
    for (const name of [
      '--box-pad',
      '--box-pad-tight',
      '--box-pad-roomy',
      '--box-gap',
      '--stack-gap',
      '--section-gap',
      '--section-head-gap',
      '--label-size',
    ])
      assert.match(tokens, new RegExp(`${name}:`), `${name} is missing`);
    const css = read('design-system/components.css');
    const card = /\.ds-card \{[^}]*\}/.exec(css)?.[0] ?? '';
    assert.match(card, /padding: var\(--box-pad\)/);
    assert.match(card, /gap: var\(--box-gap\)/);
    assert.match(card, /border-radius: var\(--radius-card\)/);
    assert.match(card, /box-shadow: var\(--shadow-card\)/);
    assert.match(css, /\.ds-sections \{[^}]*gap: var\(--section-gap\)/);
    assert.match(css, /\.ds-section-body \{[^}]*gap: var\(--stack-gap\)/);
  });

  it('a settings group, a section and a card head are one title', () => {
    const css = read('design-system/components.css');
    for (const selector of ['.ds-section-title', '.ds-settings-group-head h3']) {
      const rule =
        new RegExp(`${selector.replace(/[.]/g, '\\.')}[^{]*\\{[^}]*\\}`).exec(css)?.[0] ?? '';
      assert.match(rule, /font-size: 15px/, selector);
      assert.match(rule, /font-weight: 520/, selector);
    }
  });
});
