import { describe, expect, it } from 'bun:test';
import { readableDescription } from '../../description';

describe('readableDescription', () => {
  it('turns the escaped line breaks of a one-line text into real ones', () => {
    expect(readableDescription('## Ziel\\n\\n- eins\\n- zwei')).toBe('## Ziel\n\n- eins\n- zwei');
    expect(readableDescription('a\\r\\nb')).toBe('a\nb');
  });

  it('keeps a text that already has real line breaks, or none escaped', () => {
    expect(readableDescription('Pfad C:\\new\nzweite Zeile')).toBe('Pfad C:\\new\nzweite Zeile');
    expect(readableDescription('schlicht')).toBe('schlicht');
    expect(readableDescription('')).toBe('');
  });
});
