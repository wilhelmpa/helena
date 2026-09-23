import { describe, expect, it } from 'bun:test';
import { isValidRef, refSelector, renderSnapshot, type RawSnapshotNode } from './snapshot';

function node(overrides: Partial<RawSnapshotNode>): RawSnapshotNode {
  return {
    ref: 'e1',
    role: 'button',
    name: 'Submit',
    value: null,
    checked: null,
    disabled: false,
    credential: false,
    depth: 0,
    ...overrides,
  };
}

describe('renderSnapshot', () => {
  it('renders a placeholder for an empty tree', () => {
    expect(renderSnapshot([])).toBe('(no interactive elements found)');
  });

  it('renders ref, role and name for an ordinary node', () => {
    const text = renderSnapshot([node({ ref: 'e3', role: 'button', name: 'Login' })]);
    expect(text).toBe('[e3] button "Login"');
  });

  it('never shows the value of a credential field, only a placeholder', () => {
    const text = renderSnapshot([
      node({
        ref: 'e5',
        role: 'textbox:password',
        credential: true,
        value: 'super-secret',
        name: 'Password',
      }),
    ]);
    expect(text).not.toContain('super-secret');
    expect(text).not.toContain('Password');
    expect(text).toContain('[password — never shown]');
  });

  it('never shows the value of a filled non-password credential field (a 2FA code) either', () => {
    const text = renderSnapshot([
      node({ ref: 'e6', role: 'textbox', credential: true, value: '123456' }),
    ]);
    expect(text).not.toContain('123456');
    expect(text).toContain('[filled — never shown]');
  });

  it('shows checked state and disabled for a checkbox', () => {
    const text = renderSnapshot([
      node({ ref: 'e2', role: 'checkbox', name: 'Remember me', checked: true, disabled: true }),
    ]);
    expect(text).toContain('checked');
    expect(text).toContain('disabled');
  });

  it('indents nested nodes by depth', () => {
    const text = renderSnapshot([
      node({ ref: 'e1', role: 'generic', name: 'Form', depth: 0 }),
      node({ ref: 'e2', role: 'button', name: 'Submit', depth: 1 }),
    ]);
    const lines = text.split('\n');
    expect(lines[0].startsWith(' ')).toBe(false);
    expect(lines[1].startsWith('  ')).toBe(true);
  });
});

describe('refSelector / isValidRef', () => {
  it('builds a data-attribute selector for a ref', () => {
    expect(refSelector('e7')).toBe('[data-volition-ref="e7"]');
  });

  it("accepts the tagging script's own ref shape", () => {
    expect(isValidRef('e1')).toBe(true);
    expect(isValidRef('e42')).toBe(true);
  });

  it('rejects anything that is not exactly that shape, so a bad ref is caught before it becomes a selector', () => {
    expect(isValidRef('e0')).toBe(false); // the tagging script counts from 1
    expect(isValidRef('')).toBe(false);
    expect(isValidRef('e1"] , [onclick="evil()')).toBe(false);
    expect(isValidRef('E1')).toBe(false);
    expect(isValidRef('1')).toBe(false);
  });
});
