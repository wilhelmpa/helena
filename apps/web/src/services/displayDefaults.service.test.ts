import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { effectiveFieldDefaults } from './displayDefaults.service';

describe('the default fields in force', () => {
  it('are none while nothing is saved', () => {
    const { defaults, source } = effectiveFieldDefaults(undefined);
    assert.equal(defaults, null);
    assert.equal(source('kanban'), 'builtin');
  });

  it("take the project default over the member's, layout by layout", () => {
    const { defaults, source } = effectiveFieldDefaults({
      project: { kanban: ['id'] },
      global: { kanban: ['priority'], table: ['dueDate'] },
    });
    assert.deepEqual(defaults, { kanban: ['id'], table: ['dueDate'] });
    assert.equal(source('kanban'), 'project');
    assert.equal(source('table'), 'global');
    assert.equal(source('list'), 'builtin');
  });
});
