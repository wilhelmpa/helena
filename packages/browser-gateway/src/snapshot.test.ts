import { describe, expect, it } from 'bun:test';
import {
  CREDENTIAL_SELECTOR,
  isValidRef,
  redactValues,
  refSelector,
  truncateSnapshot,
} from './snapshot';

describe('refs of the AI snapshot', () => {
  it('accepts element refs and refs inside iframes', () => {
    expect(isValidRef('e1')).toBe(true);
    expect(isValidRef('e123')).toBe(true);
    expect(isValidRef('f2e14')).toBe(true);
  });

  it('refuses anything that could be a selector', () => {
    for (const ref of ['', 'e', 'x1', 'e1 >> css=input', '#id', 'f1', 'e1"]', 'aria-ref=e1']) {
      expect(isValidRef(ref)).toBe(false);
    }
  });

  it('resolves a ref through the aria-ref engine', () => {
    expect(refSelector('f1e3')).toBe('aria-ref=f1e3');
  });
});

describe('redactValues', () => {
  it('removes what credential fields hold, longest first, and leaves short values', () => {
    const text = '- textbox "Password": hunter22secret\n- textbox "Code": 123456\n- text: ab';
    expect(redactValues(text, ['hunter22secret', '123456', 'ab', 'hunter22'])).toBe(
      '- textbox "Password": [hidden]\n- textbox "Code": [hidden]\n- text: ab',
    );
  });

  it('changes nothing without values', () => {
    expect(redactValues('- button "Login"', [])).toBe('- button "Login"');
  });
});

describe('truncateSnapshot', () => {
  it('keeps a short snapshot and cuts a long one at a line end', () => {
    expect(truncateSnapshot('a\nb', 10)).toBe('a\nb');
    const cut = truncateSnapshot('line one\nline two\nline three', 20);
    expect(cut.startsWith('line one\nline two\n…')).toBe(true);
    expect(cut).toContain('snapshot cut at 20 characters');
  });
});

describe('CREDENTIAL_SELECTOR', () => {
  it('names password inputs, password autocomplete and one-time codes', () => {
    expect(CREDENTIAL_SELECTOR).toContain('input[type="password" i]');
    expect(CREDENTIAL_SELECTOR).toContain('autocomplete*="password"');
    expect(CREDENTIAL_SELECTOR).toContain('one-time-code');
  });
});
