import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { HttpError } from '#shared/lib';
import {
  documentMarkdownEtag,
  documentMarkdownPath,
  renderPortableDocumentMarkdown,
  shouldExportDocumentMarkdown,
  shouldLazyRetryDocumentMarkdown,
  safeDocumentMarkdownSyncError,
} from './markdown-sync';

const previousAppUrl = process.env.APP_URL;

afterEach(() => {
  if (previousAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = previousAppUrl;
});

test('uses a stable Obsidian-compatible project path based on the document id', () => {
  assert.equal(documentMarkdownPath(42), 'Dokumente/Plan/doc-42.md');
});

test('renders portable frontmatter with exact Plan and work-item links', () => {
  process.env.APP_URL = 'https://plan.volition.one/';
  const markdown = renderPortableDocumentMarkdown({
    projectKey: 'KARR',
    document: {
      id: 42,
      title: 'Bewerbung "Nord"',
      content: 'Ergebnis mit [[Obsidian-Link]].',
      isPrivate: false,
      archivedAt: null,
      version: 7,
      updatedAt: new Date('2026-09-22T08:00:00.000Z'),
    },
    linkedWorkItems: [
      {
        identifier: 'KARR-9',
        title: 'AURELIUS prüfen',
        url: 'https://plan.volition.one/project/KARR/issue/9',
      },
    ],
  });

  assert.match(markdown, /schema: "volition\.plan\.document\/v1"/);
  assert.match(markdown, /plan_document_id: 42/);
  assert.match(markdown, /document_version: 7/);
  assert.match(markdown, /plan_url: "https:\/\/plan\.volition\.one\/project\/KARR\/docs\/42"/);
  assert.match(markdown, /identifier: "KARR-9"/);
  assert.match(markdown, /url: "https:\/\/plan\.volition\.one\/project\/KARR\/issue\/9"/);
  assert.match(markdown, /\[\[Obsidian-Link\]\]/);
  assert.match(markdown, /\[KARR-9\]\(https:\/\/plan\.volition\.one\/project\/KARR\/issue\/9\)/);
});

test('never renders private document content into the shared project folder', () => {
  assert.equal(shouldExportDocumentMarkdown({ isPrivate: true }), false);
  assert.throws(
    () =>
      renderPortableDocumentMarkdown({
        projectKey: 'KARR',
        document: {
          id: 99,
          title: 'Secret',
          content: 'must not leave the database',
          isPrivate: true,
          archivedAt: null,
          version: 1,
          updatedAt: new Date('2026-09-22T08:00:00.000Z'),
        },
        linkedWorkItems: [],
      }),
    /Private documents must never be rendered/,
  );
});

test('bounds lazy retries stored in document metadata', () => {
  assert.equal(
    shouldLazyRetryDocumentMarkdown({ markdownSync: { state: 'pending', attempts: 2 } }),
    true,
  );
  assert.equal(
    shouldLazyRetryDocumentMarkdown({ markdownSync: { state: 'pending', attempts: 3 } }),
    false,
  );
  assert.equal(
    shouldLazyRetryDocumentMarkdown({ markdownSync: { state: 'synced', attempts: 0 } }),
    false,
  );
});

test('reuses only a known strong ETag and reports conflicts without overwriting', () => {
  assert.equal(
    documentMarkdownEtag({ markdownSync: { state: 'synced', etag: '"known"' } }),
    '"known"',
  );
  assert.equal(documentMarkdownEtag({}), null);
  assert.equal(documentMarkdownEtag({ markdownSync: { etag: 'W/"weak"' } }), null);
  assert.deepEqual(safeDocumentMarkdownSyncError(new HttpError(409, 'connector detail')), {
    code: 'etag_conflict',
    message: 'The generated Markdown changed concurrently.',
  });
});
