import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ApprovalRequest } from '@/lib/api/endpoints/approvals';
import type { Notification } from '@/lib/api/endpoints/notifications';
import type { AgentActivityEntry } from '@/lib/api/endpoints/agentActivity';
import type { NeedsYouEntry } from '@/extensions/needsYouSources';
import { ownerInboxItems } from './ownerInboxItems';

describe('ownerInboxItems', () => {
  it('shows each decision once and keeps finished work below the action cards', () => {
    const approval = {
      id: 8,
      projectKey: 'TRADE',
      issueId: 17,
      createdAt: '2026-09-27T20:00:00Z',
    } as ApprovalRequest;
    const mention = {
      id: 3,
      type: 'mentioned',
      issueId: 17,
      projectKey: 'TRADE',
      createdAt: '2026-09-27T20:01:00Z',
    } as Notification;
    const otherMention = {
      ...mention,
      id: 4,
      issueId: 19,
      createdAt: '2026-09-27T20:02:00Z',
    } as Notification;
    const needs = [
      { key: 'approval:8', kind: 'approval' },
      { key: 'problem:service:runner', kind: 'problem', at: '2026-09-27T20:03:00Z' },
    ] as NeedsYouEntry[];
    const activity = [
      { id: 'run:1', kind: 'agent-run', status: 'failed' },
      { id: 'run:2', kind: 'agent-run', status: 'success' },
      { id: 'run:3', kind: 'workflow-run', status: 'succeeded' },
      { id: 'chat:4', kind: 'chat', status: 'success' },
    ] as AgentActivityEntry[];
    const result = ownerInboxItems({
      approvals: [approval],
      steps: [],
      proposals: [],
      mentions: [mention, otherMention],
      needs,
      activity,
    });
    assert.deepEqual(
      result.actions.map((item) => item.key),
      ['problem:service:runner', 'approval:8', 'mention:4'],
    );
    assert.deepEqual(
      result.reads.map((item) => item.id),
      ['run:2', 'run:3'],
    );
  });
});
