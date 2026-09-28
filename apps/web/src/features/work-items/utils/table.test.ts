import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultViewSettings } from '@/utils/viewSettings';
import type { IssueGroup } from '@/utils/project';
import { buildTableItems } from './table';

test('list omits hidden groups and can still show other empty groups', () => {
  const groups: IssueGroup[] = [
    { key: 'c1', name: 'Hidden', assign: null, values: [1] },
    { key: 'c2', name: 'Shown', assign: null, values: [2] },
  ];
  const settings = { ...defaultViewSettings('table'), hiddenGroups: ['c1'] };
  const items = buildTableItems({
    groups,
    subGroups: [],
    sorted: [],
    settings,
    collapsed: new Set(),
  });
  assert.deepEqual(
    items.map((item) => (item.kind === 'header' ? item.group.key : item.kind)),
    ['c2'],
  );
});
