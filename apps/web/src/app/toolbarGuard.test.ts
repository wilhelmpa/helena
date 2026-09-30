import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

// One toolbar for every module (Auftrag 117, docs/ui-framework.md "Neues Modul: so sieht
// die Leiste aus"): a page's top row is built from PageToolbar with PageTabs/Segmented,
// PageSearch, PageFilterMenu/FilterBar, SegmentToggle and PageActions — Aufgaben is the
// reference. This guard reads every page and feature and refuses what made modules drift
// apart: a search field of its own, a filter pill of its own, a loose pill or a raw field in
// a toolbar. A module that needs something new adds it to the design system first.

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..');

export interface ToolbarViolation {
  rule: string;
  line: number;
}

// The rules on one file's source; exported for the test of the guard itself.
export function toolbarViolations(source: string): ToolbarViolation[] {
  const found: ToolbarViolation[] = [];
  const lineOf = (index: number) => source.slice(0, index).split('\n').length;
  const add = (rule: string, index: number) => found.push({ rule, line: lineOf(index) });
  for (const match of source.matchAll(/type=["']search["']/g))
    add('a search field of its own: use PageSearch (toolbar) or SearchField', match.index);
  for (const match of source.matchAll(/\bSearchInput\b/g))
    add('a search box of its own: use SearchField (content) or PageSearch (toolbar)', match.index);
  for (const match of source.matchAll(/["'`\s]ds-pill-button\b/g))
    add('a filter pill of its own: use PageFilterMenu, FilterBar or PageTabs', match.index);
  // What stands between <PageToolbar> and </PageToolbar>.
  for (const block of source.matchAll(/<PageToolbar\b[\s\S]*?<\/PageToolbar>/g)) {
    const body = block[0];
    const at = block.index;
    for (const match of body.matchAll(/<PillButton\b/g))
      add(
        'a loose pill in a toolbar: use SegmentToggle, PageTabs or PageActions',
        at + match.index,
      );
    for (const match of body.matchAll(/<input\b/g))
      add('a raw field in a toolbar: use PageSearch or PageSelect', at + match.index);
    for (const match of body.matchAll(/<SearchField\b/g))
      add('a search field in a toolbar: use PageSearch', at + match.index);
  }
  return found;
}

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (/\.tsx$/.test(name) && !/\.test\.tsx$/.test(name)) out.push(path);
  }
  return out;
}

// Where the rules do not apply, with the reason.
const ALLOWED: Record<string, string> = {
  // The gallery shows every building block, the pills among them.
  'features/ui-gallery/UiGallery.tsx': 'the gallery of the building blocks',
};

describe('toolbar guard', () => {
  it('finds a module that builds its own toolbar parts', () => {
    const wrong = [
      'export default function Wrong() {',
      '  return (',
      '    <PageToolbar>',
      '      <PillButton onClick={() => undefined}>Nur offene</PillButton>',
      '      <input value="" onChange={() => undefined} />',
      '    </PageToolbar>',
      '  );',
      '}',
      'const Search = () => <input type="search" />;',
      'const Pill = () => <button className="ds-pill-button">Agent</button>;',
    ].join('\n');
    const rules = toolbarViolations(wrong).map((violation) => violation.line);
    assert.deepEqual(
      rules.sort((a, b) => a - b),
      [4, 5, 9, 10],
    );
    const right = [
      '<PageToolbar>',
      '  <PageTabs label="Ansicht" value="board" items={[]} onChange={() => undefined} />',
      '  <PageToolbarSpacer />',
      '  <PageSearch value="" onChange={() => undefined} />',
      '  <SegmentToggle pressed={false} onPressedChange={() => undefined}>Aufgaben</SegmentToggle>',
      '  <PageActions primary={primary} />',
      '</PageToolbar>',
    ].join('\n');
    assert.deepEqual(toolbarViolations(right), []);
  });

  it('every page and feature builds its toolbar from the design system', () => {
    const problems: string[] = [];
    for (const root of ['app', 'features', 'components/helena']) {
      for (const file of sources(join(srcDir, root))) {
        const name = relative(srcDir, file);
        if (ALLOWED[name]) continue;
        for (const violation of toolbarViolations(readFileSync(file, 'utf8')))
          problems.push(`${name}:${violation.line} ${violation.rule}`);
      }
    }
    assert.deepEqual(problems, []);
  });
});
