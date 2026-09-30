import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

// One overlay system (owner 30.09., O102, docs/ui-konsistenz-refactor.md §1): a thing that opens
// over or beside a page is the design system's Overlay (a side panel), its Modal (a large
// dialog with sections) or a small Dialog - never a panel of its own with its own scrim, its
// own head and its own Esc. This guard reads every page, feature and component and refuses
// what made overlays drift apart: a shadcn Sheet, a hand-made full-screen scrim or side panel,
// a fixed 680px panel, and the head classes the design system owns (the head's controls are
// guarded separately in overlayControlsGuard.test.ts).

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..');

export interface OverlayViolation {
  rule: string;
  line: number;
}

// The rules on one file's source; exported for the test of the guard itself.
export function overlayViolations(source: string): OverlayViolation[] {
  const found: OverlayViolation[] = [];
  const lineOf = (index: number) => source.slice(0, index).split('\n').length;
  const add = (rule: string, index: number) => found.push({ rule, line: lineOf(index) });
  for (const match of source.matchAll(/from ['"]@\/components\/ui\/sheet['"]/g))
    add('a Sheet of its own: use Overlay (design-system)', match.index);
  for (const match of source.matchAll(/fixed inset-(0|y-0)[^"'`]*bg-(black|background)/g))
    add('a full-screen scrim or panel of its own: use Overlay, Modal or Dialog', match.index);
  for (const match of source.matchAll(/\bsm:w-\[680px\]/g))
    add(
      'a side panel of a fixed width of its own: use Overlay (width: default | wide)',
      match.index,
    );
  for (const match of source.matchAll(/\sdata-slot=["']sheet-(content|overlay)["']/g))
    add('a hand-made sheet: use Overlay', match.index);
  for (const match of source.matchAll(/["'`\s](ds-panel-head|ds-panel-tabs)\b/g))
    add('the overlay head drawn by hand: use OverlayHead', match.index);
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
  'components/ui/sheet.tsx': 'the primitive itself (the sidebar drawer uses it)',
  'components/ui/dialog.tsx': 'the primitive itself (Dialog and Modal are built on it)',
  'components/ui/alert-dialog.tsx': 'the primitive itself (ConfirmDialog is built on it)',
  'components/ui/sidebar.tsx': 'the sidebar drawer on a phone',
  'features/owner-terminal/components/TerminalTabBar.tsx':
    "the terminal sessions in the panel's tab look, until they are a SegmentTrack (wave 1C)",
  'design-system/layout/OverlayHead.tsx': 'the component itself',
  'features/ui-gallery/UiGallery.tsx': 'the gallery of the building blocks',
  'features/notes/components/NoteCanvas.tsx':
    'the full screen of a canvas inside a page, not an overlay',
  'components/common/page/TakeoverScreen.tsx':
    'the page that takes the browser over, not an overlay',
};

describe('overlay guard', () => {
  it('finds an overlay built by hand', () => {
    const wrong = [
      "import { Sheet } from '@/components/ui/sheet';",
      'export default function Wrong() {',
      '  return (',
      '    <div className="fixed inset-0 z-40 flex bg-black/20">',
      '      <div data-slot="sheet-content" className="ml-auto sm:w-[680px]">',
      '        <div className="ds-panel-head" />',
      '      </div>',
      '    </div>',
      '  );',
      '}',
    ].join('\n');
    assert.deepEqual(
      overlayViolations(wrong)
        .map((violation) => violation.line)
        .sort((a, b) => a - b),
      [1, 4, 5, 5, 6],
    );
  });

  it('accepts an overlay built from the design system', () => {
    const right = [
      "import { Overlay } from '@/design-system';",
      'export default function Right() {',
      "  return <Overlay label=\"x\" tabs={[{ id: 'a', label: 'A' }]} onClose={() => undefined}>x</Overlay>;",
      '}',
    ].join('\n');
    assert.deepEqual(overlayViolations(right), []);
  });

  it('every page, feature and component opens its overlays through the design system', () => {
    const violations: string[] = [];
    for (const file of sources(srcDir)) {
      const name = relative(srcDir, file).split('\\').join('/');
      if (name in ALLOWED) continue;
      for (const violation of overlayViolations(readFileSync(file, 'utf8')))
        violations.push(`${name}:${violation.line} ${violation.rule}`);
    }
    assert.deepEqual(violations, []);
  });
});
