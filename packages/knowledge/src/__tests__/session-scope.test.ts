import { expect, test } from 'bun:test';
import { agentSessionScope } from '../sources/helena-runtime';
import { ANY_RESOURCE, canRead, emptyReach } from '../reach';

const session = {
  teamId: 1,
  projectId: 19,
  kind: 'chat',
  chatThreadId: 'test-thread',
  agentUserId: 'agent-self',
};

test('chat sessions stay private even with project or team access', () => {
  const scope = agentSessionScope(session);
  const item = {
    ...scope,
    projectId: scope.projectId ?? null,
    ownerId: scope.ownerId ?? null,
    permission: scope.permission ?? null,
  };
  const stranger = emptyReach('agent-other');
  stranger.projects.set(19, new Set([ANY_RESOURCE]));
  stranger.teams.set(1, new Set([ANY_RESOURCE]));
  expect(canRead(stranger, item)).toBe(false);
  expect(canRead(emptyReach('agent-self'), item)).toBe(true);
  expect(agentSessionScope({ ...session, projectId: null }).visibility).toBe('private');
  expect(agentSessionScope({ ...session, chatThreadId: null }).visibility).toBe('private');
  expect(agentSessionScope({ ...session, kind: 'reflection', chatThreadId: null }).visibility).toBe(
    'private',
  );
});

test('task sessions retain project or team permissions', () => {
  expect(agentSessionScope({ ...session, kind: 'run', chatThreadId: null })).toEqual({
    teamId: 1,
    projectId: 19,
    visibility: 'project',
    permission: 'ai_agents',
  });
  expect(
    agentSessionScope({ ...session, kind: 'run', chatThreadId: null, projectId: null }).visibility,
  ).toBe('team');
});
