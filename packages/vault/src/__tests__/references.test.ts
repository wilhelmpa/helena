import { describe, expect, it } from 'bun:test';
import { movedReferencePath, rewriteVaultReferences } from '../references';

describe('Vault references', () => {
  it('updates full and unambiguous short wiki links while keeping headings and labels', () => {
    const content = '[[Projects/VOL/Docs/Old#Section|Label]] and [[Old]] and [[Other]]';
    expect(
      rewriteVaultReferences(
        content,
        'note',
        'Projects/VOL/Docs/Old.md',
        'Projects/VOL/Docs/New.md',
        true,
      ),
    ).toBe('[[Projects/VOL/Docs/New#Section|Label]] and [[New]] and [[Other]]');
  });

  it('updates folder paths in wiki links and file nodes of canvases', () => {
    const content = JSON.stringify({
      nodes: [
        { type: 'file', file: 'Projects/VOL/Docs/Old/a.md' },
        { type: 'text', text: '[[Projects/VOL/Docs/Old/a]]' },
      ],
    });
    const changed = rewriteVaultReferences(
      content,
      'canvas',
      'Projects/VOL/Docs/Old',
      'Projects/VOL/Docs/New',
      false,
    );
    const canvas = JSON.parse(changed);
    expect(canvas.nodes[0].file).toBe('Projects/VOL/Docs/New/a.md');
    expect(canvas.nodes[1].text).toBe('[[Projects/VOL/Docs/New/a]]');
    expect(
      movedReferencePath(
        'Projects/VOL/Docs/Old/a.md',
        'Projects/VOL/Docs/Old',
        'Projects/VOL/Docs/New',
      ),
    ).toBe('Projects/VOL/Docs/New/a.md');
  });

  it('updates relative wiki links within the same Vault area', () => {
    expect(
      rewriteVaultReferences(
        '[[Sub/Old]]',
        'note',
        'Projects/VOL/Docs/Sub/Old.md',
        'Projects/VOL/Other/New.md',
        false,
        true,
      ),
    ).toBe('[[Projects/VOL/Other/New]]');
  });

  it('updates relative file nodes when their target moves', () => {
    const canvas = JSON.stringify({ nodes: [{ type: 'file', file: '../Docs/Old.md' }] });
    const updated = rewriteVaultReferences(
      canvas,
      'canvas',
      'Projects/VOL/Docs/Old.md',
      'Projects/VOL/Docs/New.md',
      false,
      true,
      'Projects/VOL/Boards/Plan.canvas',
    );
    expect(JSON.parse(updated).nodes[0].file).toBe('../Docs/New.md');
  });
});
