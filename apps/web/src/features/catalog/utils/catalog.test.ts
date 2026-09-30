import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CatalogFinding, CatalogSnapshotFile } from '@/lib/api/endpoints/catalog';
import {
  decodeContent,
  formatBytes,
  hasNewVersion,
  isMarkdownFile,
  shortHash,
  shortPin,
  sourceLabel,
  verdictOf,
  withoutFrontMatter,
} from './catalog';

const finding = (severity: CatalogFinding['severity']): CatalogFinding => ({
  code: 'x',
  severity,
  path: '',
  detail: '',
});

describe('catalog helpers', () => {
  it('shortens a commit but keeps a package version and a GitHub package pin readable', () => {
    assert.equal(shortPin('a'.repeat(40)), 'aaaaaaa');
    assert.equal(shortPin('1.2.0'), '1.2.0');
    assert.equal(shortPin(`${'b'.repeat(40)}@2.0.1`), 'bbbbbbb · 2.0.1');
    assert.equal(shortHash('0123456789abcdef'), '0123456789');
  });

  it('names a source without its scheme', () => {
    assert.equal(sourceLabel('https://github.com/org/repo'), 'org/repo');
    assert.equal(sourceLabel('@scope/package'), '@scope/package');
  });

  it('reads the verdict from the worst finding', () => {
    assert.equal(verdictOf([]), 'clean');
    assert.equal(verdictOf([finding('info')]), 'clean');
    assert.equal(verdictOf([finding('info'), finding('review')]), 'review');
    assert.equal(verdictOf([finding('review'), finding('block')]), 'blocked');
  });

  it('marks a newer inspected version of an installed entry only', () => {
    assert.equal(hasNewVersion({ installed: true, installedPin: 'a', latestPin: 'b' }), true);
    assert.equal(hasNewVersion({ installed: true, installedPin: 'b', latestPin: 'b' }), false);
    assert.equal(hasNewVersion({ installed: false, installedPin: null, latestPin: 'b' }), false);
    assert.equal(hasNewVersion({ installed: true, installedPin: 'a', latestPin: null }), false);
  });

  it('decodes base64 file content as UTF-8 and reports a hidden file as null', () => {
    const file = (content: string): CatalogSnapshotFile => ({
      path: 'f',
      content,
      size: 0,
      sha256: '',
    });
    assert.equal(
      decodeContent(file(Buffer.from('Prüfe Änderungen ✓').toString('base64'))),
      'Prüfe Änderungen ✓',
    );
    assert.equal(decodeContent(file('')), null);
    assert.equal(decodeContent(null), null);
  });

  it('strips the front matter of a SKILL.md and recognises markdown files', () => {
    assert.equal(withoutFrontMatter('---\nname: a\n---\n\n# Titel\n'), '# Titel\n');
    assert.equal(withoutFrontMatter('# Ohne'), '# Ohne');
    assert.equal(isMarkdownFile('references/checklist.md'), true);
    assert.equal(isMarkdownFile('scripts/run.sh'), false);
  });

  it('formats sizes', () => {
    assert.equal(formatBytes(457), '457 B');
    assert.equal(formatBytes(2048), '2.0 KB');
    assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
  });
});
