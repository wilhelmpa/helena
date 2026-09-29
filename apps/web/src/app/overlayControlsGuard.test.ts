import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

// One set of controls for every overlay head (owner 29.09., O83, docs/ui-framework.md §12):
// its own page · pin · full screen ↔ normal · close come from OverlayControls — the same
// symbols, sizes, tooltips and order in the overlay, the tool panel, a dialog. This guard
// reads every page, feature and component and refuses a head that draws its own: an
// enlarge/reduce symbol, one of the head's control classes, or a head's tools without the
// component. (A pin that means something else — a pinned chat or column — is not a head.)

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..');

export interface ControlViolation {
  rule: string;
  line: number;
}

const HEAD_CLASSES = ['ds-panel-pin', 'ds-panel-full', 'ds-panel-open-page', 'ds-panel-close'];

// The rules on one file's source; exported for the test of the guard itself.
export function controlViolations(source: string): ControlViolation[] {
  const found: ControlViolation[] = [];
  const lineOf = (index: number) => source.slice(0, index).split('\n').length;
  const add = (rule: string, index: number) => found.push({ rule, line: lineOf(index) });
  for (const match of source.matchAll(/\b(Maximize2|Minimize2)\b/g))
    add(
      'an enlarge/reduce button of its own: use OverlayControls (full, onToggleFull)',
      match.index,
    );
  for (const name of HEAD_CLASSES)
    for (const match of source.matchAll(new RegExp(`["'\`\\s]${name}\\b`, 'g')))
      add(`the head control ${name} drawn by hand: use OverlayControls`, match.index);
  // A head (the tools of a panel, overlay or dialog) that does not render OverlayControls.
  if (!/<OverlayControls\b/.test(source))
    for (const match of source.matchAll(/["'`\s](ds-panel-head-tools|ds-dialog-tools)\b/g))
      add('a head without OverlayControls: pin, full screen and close come from it', match.index);
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
  'design-system/components/OverlayControls.tsx': 'the component itself',
  'features/ui-gallery/UiGallery.tsx': 'the gallery of the building blocks',
  'features/notes/components/NoteCanvasControls.tsx':
    'the full screen of a canvas inside a page, not the head of an overlay or panel',
  'features/teams/components/ai-agents/AgentInstructionsField.tsx':
    'enlarges a text field, not an overlay',
};

describe('overlay controls guard', () => {
  it('finds a head that draws its own controls', () => {
    const wrong = [
      "import { Maximize2, X } from 'lucide-react';",
      'export default function Wrong({ onTogglePin }) {',
      '  return (',
      '    <div className="ds-panel-head-tools">',
      '      <button className="ds-icon-button ds-panel-pin"><Pin size={15} /></button>',
      '      <button><Maximize2 /></button>',
      '    </div>',
      '  );',
      '}',
    ].join('\n');
    assert.deepEqual(
      controlViolations(wrong)
        .map((violation) => violation.line)
        .sort((a, b) => a - b),
      [1, 4, 5, 6],
    );
  });

  it('accepts a head built from OverlayControls', () => {
    const right = [
      "import { OverlayControls } from '@/design-system';",
      'export default function Right() {',
      '  return <OverlayControls onClose={() => undefined} full={false} onToggleFull={() => undefined} />;',
      '}',
    ].join('\n');
    assert.deepEqual(controlViolations(right), []);
  });

  it('every overlay, panel and dialog head uses OverlayControls', () => {
    const violations: string[] = [];
    for (const file of sources(srcDir)) {
      const name = relative(srcDir, file).split('\\').join('/');
      if (name in ALLOWED) continue;
      for (const violation of controlViolations(readFileSync(file, 'utf8')))
        violations.push(`${name}:${violation.line} ${violation.rule}`);
    }
    assert.deepEqual(violations, []);
  });
});
