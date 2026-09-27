import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Notification } from '@/lib/api/endpoints/notifications';
import { groupNotifications } from './notificationGroups';

const notification = (id: number, projectKey: string, type: Notification['type']) =>
  ({
    id,
    projectKey,
    projectName: projectKey,
    type,
  }) as Notification;

describe('inbox grouping', () => {
  it('groups Home by project and then by type', () => {
    const groups = groupNotifications(
      [
        notification(1, 'VOL', 'mentioned'),
        notification(2, 'TRADE', 'approval_requested'),
        notification(3, 'VOL', 'assigned'),
      ],
      true,
    );
    assert.deepEqual(
      groups.map((group) => [group.key, group.total]),
      [
        ['VOL', 2],
        ['TRADE', 1],
      ],
    );
    assert.deepEqual(
      groups[0]?.groups.map((group) => group.kind),
      ['mentions', 'system'],
    );
    assert.deepEqual(
      groups[1]?.groups.map((group) => group.kind),
      ['approvals'],
    );
  });

  it('groups a project by type only', () => {
    const groups = groupNotifications([notification(1, 'VOL', 'mentioned')], false);
    assert.equal(groups.length, 1);
    assert.equal(groups[0]?.key, '');
  });
});
