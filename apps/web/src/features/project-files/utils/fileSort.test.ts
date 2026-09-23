import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { FileItem } from '@/lib/api/endpoints/projectFiles';
import { visibleItems } from './fileSort';

const item = (name: string, kind: FileItem['kind'], sizeBytes: number, updatedAt: string) => ({
  name,
  path: name,
  kind,
  sizeBytes,
  contentType: null,
  updatedAt,
});

const items: FileItem[] = [
  item('Rechnung 10.pdf', 'file', 300, '2026-01-03'),
  item('Rechnung 2.pdf', 'file', 100, '2026-01-01'),
  item('Archiv', 'folder', 0, '2026-01-02'),
  item('angebot.docx', 'file', 200, '2026-01-02'),
];

const names = (list: FileItem[]) => list.map((entry) => entry.name);

describe('visibleItems', () => {
  it('puts folders first and sorts names naturally', () => {
    assert.deepEqual(names(visibleItems(items, '', { key: 'name', descending: false })), [
      'Archiv',
      'angebot.docx',
      'Rechnung 2.pdf',
      'Rechnung 10.pdf',
    ]);
  });

  it('sorts by size or date in either direction, folders still first', () => {
    assert.deepEqual(names(visibleItems(items, '', { key: 'size', descending: true })), [
      'Archiv',
      'Rechnung 10.pdf',
      'angebot.docx',
      'Rechnung 2.pdf',
    ]);
    assert.deepEqual(names(visibleItems(items, '', { key: 'modified', descending: false })), [
      'Archiv',
      'Rechnung 2.pdf',
      'angebot.docx',
      'Rechnung 10.pdf',
    ]);
  });

  it('filters by a part of the name, ignoring case', () => {
    assert.deepEqual(names(visibleItems(items, ' RECHNUNG ', { key: 'name', descending: false })), [
      'Rechnung 2.pdf',
      'Rechnung 10.pdf',
    ]);
  });
});
