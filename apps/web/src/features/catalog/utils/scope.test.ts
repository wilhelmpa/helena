import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { choiceOf, emptyScope, scopeOf } from './scope';

describe('catalog scope', () => {
  it('sends nothing to any agent for the library and waits for a complete choice otherwise', () => {
    assert.deepEqual(scopeOf(emptyScope), {});
    assert.equal(scopeOf({ ...emptyScope, mode: 'project' }), null);
    assert.equal(scopeOf({ ...emptyScope, mode: 'agent' }), null);
    assert.equal(scopeOf({ ...emptyScope, mode: 'role' }), null);
  });

  it('builds the scope the API accepts: an agent alone, a project, or a role with an optional project', () => {
    assert.deepEqual(scopeOf({ ...emptyScope, mode: 'agent', agentId: 4 }), { agentId: 4 });
    assert.deepEqual(scopeOf({ ...emptyScope, mode: 'project', projectId: 1 }), { projectId: 1 });
    assert.deepEqual(scopeOf({ ...emptyScope, mode: 'role', roleId: 2 }), { roleId: 2 });
    assert.deepEqual(scopeOf({ ...emptyScope, mode: 'role', roleId: 2, projectId: 1 }), {
      roleId: 2,
      projectId: 1,
    });
  });

  it('reads an installation back into the choice it was made with', () => {
    assert.deepEqual(choiceOf(undefined), emptyScope);
    assert.deepEqual(choiceOf({}), emptyScope);
    assert.equal(choiceOf({ agentId: 4 }).mode, 'agent');
    assert.equal(choiceOf({ projectId: 1 }).mode, 'project');
    assert.deepEqual(choiceOf({ roleId: 2, projectId: 1 }), {
      mode: 'role',
      projectId: 1,
      agentId: null,
      roleId: 2,
    });
  });
});
