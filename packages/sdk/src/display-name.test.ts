import { describe, expect, test } from 'bun:test';
import { renderDisplayName } from './display-name';

describe('display name templates', () => {
  test('defaults to Ava and preserves internal identifiers and personal names', () => {
    expect(renderDisplayName('{appName}: Helena Müller; @helena/sdk; Hermes')).toBe(
      'Ava: Helena Müller; @helena/sdk; Hermes',
    );
  });
  test('renders nested templates without replacing keys or mutating the input', () => {
    const source = {
      name: 'helena',
      description: '{appName} tools',
      files: [{ path: 'SOUL.md', content: '{appName}s tools' }],
    };
    expect(renderDisplayName(source, 'Nova')).toEqual({
      name: 'helena',
      description: 'Nova tools',
      files: [{ path: 'SOUL.md', content: 'Novas tools' }],
    });
    expect(source.description).toBe('{appName} tools');
  });
});
