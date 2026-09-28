import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pickActive, type NavCandidate } from './activeMatch';

const project: NavCandidate[] = [
  { id: 'inbox', href: '/project/TRADE/inbox' },
  { id: 'dashboard', href: '/project/TRADE/dashboard', exact: true },
  { id: 'dash-1', href: '/project/TRADE/dashboard/1' },
  {
    id: 'tasks',
    href: '/project/TRADE',
    exact: true,
    also: ['/project/TRADE/issue', '/project/TRADE/cycles'],
  },
  { id: 'view-5', href: '/project/TRADE/view/5' },
  { id: 'goals', href: '/project/TRADE/initiatives' },
  { id: 'knowledge', href: '/project/TRADE/files', without: ['path'] },
  { id: 'folder-Berichte', href: '/project/TRADE/files?path=Berichte' },
  { id: 'receipts', href: '/project/TRADE/receipts' },
  { id: 'team', href: '/project/TRADE/ai-agents', also: ['/project/TRADE/organization'] },
  { id: 'settings-general', href: '/project/TRADE/settings/general' },
];

const at = (url: string) => {
  const [pathname = '', search = ''] = url.split('?');
  return pickActive(project, { pathname, search });
};

describe('pickActive', () => {
  it('exactly one row per location', () => {
    assert.equal(at('/project/TRADE'), 'tasks');
    assert.equal(at('/project/TRADE/view/5'), 'view-5');
    assert.equal(at('/project/TRADE/issue/12'), 'tasks');
    assert.equal(at('/project/TRADE/dashboard'), 'dashboard');
    assert.equal(at('/project/TRADE/dashboard/1'), 'dash-1');
    assert.equal(at('/project/TRADE/initiatives/details/3'), 'goals');
    assert.equal(at('/project/TRADE/organization'), 'team');
    assert.equal(at('/project/TRADE/settings/general'), 'settings-general');
  });
  it('a folder row wins over its root, the root only without a path', () => {
    assert.equal(at('/project/TRADE/files'), 'knowledge');
    assert.equal(at('/project/TRADE/files?path=Berichte'), 'folder-Berichte');
    assert.equal(at('/project/TRADE/files?path=Other'), null);
  });
  it('an unknown location marks nothing', () => {
    assert.equal(at('/project/OTHER'), null);
  });
});
