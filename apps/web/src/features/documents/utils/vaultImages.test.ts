import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { vaultFileUrl } from '@/lib/api/endpoints/knowledge';
import {
  fromEditorImages,
  relativeImagePath,
  resolveImagePath,
  toEditorImages,
} from './vaultImages';

const NOTE = 'Projects/VOL/Docs/Guides/Release.md';

describe('resolveImagePath', () => {
  it('resolves a src relative to the note folder', () => {
    assert.equal(
      resolveImagePath(NOTE, 'Assets/chart.png'),
      'Projects/VOL/Docs/Guides/Assets/chart.png',
    );
    assert.equal(resolveImagePath(NOTE, './a.png'), 'Projects/VOL/Docs/Guides/a.png');
    assert.equal(resolveImagePath(NOTE, '../../Assets/a%202.png'), 'Projects/VOL/Assets/a 2.png');
  });

  it('reads a src that starts with a vault folder from the vault root', () => {
    assert.equal(resolveImagePath(NOTE, 'Projects/VOL/Assets/a.png'), 'Projects/VOL/Assets/a.png');
    assert.equal(resolveImagePath(NOTE, 'Home/Assets/a.png'), 'Home/Assets/a.png');
  });

  it('leaves URLs, web paths and paths outside the vault alone', () => {
    assert.equal(resolveImagePath(NOTE, 'https://example.test/a.png'), null);
    assert.equal(resolveImagePath(NOTE, 'data:image/png;base64,AAAA'), null);
    assert.equal(resolveImagePath(NOTE, '/media/a.png'), null);
    assert.equal(resolveImagePath(NOTE, '../../../../../a.png'), null);
  });
});

describe('relativeImagePath', () => {
  it('links a file from the note folder, encoding what ends a Markdown link', () => {
    assert.equal(
      relativeImagePath('Home/Docs/Plan.md', 'Home/Docs/Assets/image 2.png'),
      'Assets/image%202.png',
    );
    assert.equal(
      relativeImagePath(NOTE, 'Projects/VOL/Assets/a(1).png'),
      '../../Assets/a%281%29.png',
    );
    assert.equal(relativeImagePath('Plan.md', 'Assets/a.png'), 'Assets/a.png');
  });
});

describe('editor image sources', () => {
  it('loads vault images as file URLs and saves them back as written', () => {
    const markdown = [
      '![Chart](Assets/chart.png "Q3")',
      'Text ![b](<../../Assets/b c.png>) and ![](Projects/VOL/Assets/d.png)',
      '![web](https://example.test/e.png)',
      '<img src="Assets/f.png" width="200">',
    ].join('\n');
    const { markdown: shown, sources } = toEditorImages(markdown, NOTE);

    assert.equal(
      shown.split('\n')[0],
      `![Chart](${vaultFileUrl('Projects/VOL/Docs/Guides/Assets/chart.png')} "Q3")`,
    );
    assert.ok(shown.includes(vaultFileUrl('Projects/VOL/Assets/b c.png')));
    assert.ok(shown.includes(vaultFileUrl('Projects/VOL/Assets/d.png')));
    assert.ok(shown.includes('![web](https://example.test/e.png)'));
    assert.ok(
      shown.includes(`<img src="${vaultFileUrl('Projects/VOL/Docs/Guides/Assets/f.png')}"`),
    );
    assert.equal(fromEditorImages(shown, NOTE, sources), markdown);
  });

  it('saves an image added in the editor relative to the note', () => {
    const added = vaultFileUrl('Projects/VOL/Docs/Guides/Assets/image 2.png');
    assert.equal(
      fromEditorImages(`![image 2.png](${added})`, NOTE, new Map()),
      '![image 2.png](Assets/image%202.png)',
    );
    assert.equal(
      fromEditorImages(`<img src="${added}" alt="" width="120">`, NOTE, new Map()),
      '<img src="Assets/image%202.png" alt="" width="120">',
    );
  });

  it('does not touch images in code', () => {
    const markdown = [
      '`![a](Assets/a.png)` and ``![b](b.png)``',
      '```md',
      '![c](Assets/c.png)',
      '```',
      '~~~',
      '![d](d.png)',
      '~~~',
    ].join('\n');
    assert.equal(toEditorImages(markdown, NOTE).markdown, markdown);
  });
});
