import { describe, expect, it } from 'bun:test';
import {
  compileBaseExpression,
  compileBaseFilter,
  parseBase,
  serializeBase,
  UnsupportedBaseExpression,
  type BaseItem,
} from '../base';
import { isVersioned } from '../git';
import { isTextFile } from '../mime';

const sample = `# keep this comment\nfilters:\n  and:\n    - 'file.inFolder("Projects/MKT/Docs")'\n    - 'note.status == "active"'\nformulas:\n  gross: 'note.net * 1.19'\nviews:\n  - type: table\n    name: Wissen\n    order: [file.name, note.status, formula.gross]\n    pluginOption: { color: blue }\n  - type: cards\n    name: Karten\n  - type: list\n    name: Liste\npluginRoot: true\n`;

const item: BaseItem = {
  file: {
    path: 'Projects/MKT/Docs/Test.md',
    name: 'Test.md',
    basename: 'Test',
    folder: 'Projects/MKT/Docs',
    ext: 'md',
    ctime: null,
    mtime: null,
  },
  note: { status: 'active', net: 100 },
  formula: {},
};

describe('Obsidian Base subset', () => {
  it('treats .base as versioned vault text', () => {
    expect(isTextFile('Projects/MKT/Docs/Wissen.base')).toBe(true);
    expect(isVersioned('Projects/MKT/Docs/Wissen.base')).toBe(true);
  });
  it('round trips comments and unknown keys exactly without edits', () => {
    const parsed = parseBase(sample);
    expect(parsed.definition.views.map((view) => view.type)).toEqual(['table', 'cards', 'list']);
    expect(serializeBase(parsed)).toBe(sample);
  });

  it('keeps unknown keys when editing a supported top-level field', () => {
    const parsed = parseBase(sample);
    parsed.definition.formulas = { gross: 'note.net * 1.20' };
    const output = serializeBase(parsed);
    expect(output).toContain('pluginRoot: true');
    expect(output).toContain('pluginOption: { color: blue }');
    expect(parseBase(output).definition.formulas).toEqual({ gross: 'note.net * 1.20' });
  });

  it('evaluates safe filters and numeric formulas without eval', () => {
    const parsed = parseBase(sample);
    expect(compileBaseFilter(parsed.definition.filters)(item)).toBe(true);
    expect(compileBaseExpression('note.net * 1.19')(item)).toBe(119);
    expect(compileBaseExpression('note.net-1')(item)).toBe(99);
    expect(compileBaseExpression('if(note.status == "active", note.net, 0)')(item)).toBe(100);
    expect(() => compileBaseExpression('process.exit()')).toThrow(UnsupportedBaseExpression);
  });
});
