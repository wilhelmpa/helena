import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { documentMarkdownPath, documentMarkdownSyncPresentation } from './documentMarkdownSync';

describe('document Markdown sync presentation', () => {
  it('uses the stable portable project path', () => {
    assert.equal(documentMarkdownPath(42), 'Dokumente/Plan/doc-42.md');
  });

  it('opens project files only for synced documents', () => {
    assert.deepEqual(documentMarkdownSyncPresentation('synced'), {
      labelKey: 'synced',
      hintKey: 'syncedHint',
      canOpenFiles: true,
      canRetry: false,
    });
  });

  it('offers an explicit retry only while pending', () => {
    assert.deepEqual(documentMarkdownSyncPresentation('pending'), {
      labelKey: 'pending',
      hintKey: 'pendingHint',
      canOpenFiles: false,
      canRetry: true,
    });
  });

  it('keeps private documents out of shared project files', () => {
    assert.deepEqual(documentMarkdownSyncPresentation('private_not_exported'), {
      labelKey: 'privateNotExported',
      hintKey: 'privateHint',
      canOpenFiles: false,
      canRetry: false,
    });
  });
});
