import { describe, expect, it } from 'bun:test';
import { readableText } from '../text';

describe('readableText', () => {
  it('turns a run report into its sentences, the summary first', () => {
    const report = JSON.stringify({
      evidence: [{ ref: 'e2e/a.md', kind: 'test', label: 'Inhalt geprüft' }],
      summary: 'Datei angelegt und verifiziert.',
      startedAt: '2026-09-24T17:53:03.303Z',
    });
    expect(readableText(report)).toBe('Datei angelegt und verifiziert.\ne2e/a.md\ntest\nInhalt geprüft');
  });

  it('leaves plain text and broken JSON alone', () => {
    expect(readableText('Fertig: alles erledigt.')).toBe('Fertig: alles erledigt.');
    expect(readableText('{ kein json')).toBe('{ kein json');
  });
});
