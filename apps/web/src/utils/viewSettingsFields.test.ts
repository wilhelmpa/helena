import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ProjectFeatureSet } from './projectFeatures';
import {
  defaultViewSettings,
  fieldChoices,
  getViewSettings,
  normalizeViewSettings,
  type ViewSettings,
} from './viewSettings';

const features = {
  initiatives: true,
  cycles: true,
  subtasks: true,
  pointsEstimate: false,
  timeEstimate: false,
} as ProjectFeatureSet;

describe('the field "Ziel" of a task view', () => {
  it('keeps a display saved under the old name of the goal', () => {
    const stored = {
      group: 'initiative',
      subgroup: 'initiative',
      properties: ['id', 'initiative', 'goal', 'priority'],
    } as unknown as Partial<ViewSettings>;
    const settings = normalizeViewSettings(stored, 'kanban');
    assert.equal(settings.group, 'goal');
    // A sub-group equal to the group collapses, as for any other field.
    assert.equal(settings.subgroup, 'none');
    assert.deepEqual(settings.properties, ['id', 'goal', 'priority']);
  });

  it("is always offered: the goals are the team's, not a section the project turns off", () => {
    const off = { ...features, initiatives: false } as ProjectFeatureSet;
    assert.ok(fieldChoices('kanban', off).includes('goal'));
    assert.ok(fieldChoices('table', off).includes('goal'));
  });
});

describe('the fields a project or a member saved as the default', () => {
  it('start a display nobody changed, per layout', () => {
    const defaults = { kanban: ['id', 'goal', 'dueDate'], table: [] };
    assert.deepEqual(defaultViewSettings('kanban', defaults).properties, ['id', 'goal', 'dueDate']);
    // An empty default is a choice too: no fields.
    assert.deepEqual(defaultViewSettings('table', defaults).properties, []);
    // A layout without a saved default keeps the built-in one.
    assert.deepEqual(
      defaultViewSettings('list', defaults).properties,
      defaultViewSettings('list').properties,
    );
  });

  it('drop unknown keys and read the old name of the goal', () => {
    const settings = defaultViewSettings('kanban', {
      kanban: ['id', 'initiative', 'nonsense', 'cf:7', 'id'],
    });
    assert.deepEqual(settings.properties, ['id', 'goal', 'cf:7']);
  });

  it('do not overwrite what a member chose for one view', () => {
    const stored = { properties: ['priority'] } as Partial<ViewSettings>;
    const settings = normalizeViewSettings(stored, 'kanban', { kanban: ['id', 'goal'] });
    assert.deepEqual(settings.properties, ['priority']);
  });

  it('are read where a display is loaded from the browser', () => {
    // Without a store in this environment the display is the default of the layout.
    const settings = getViewSettings('NOPE', 'kanban', { kanban: ['id'] });
    assert.deepEqual(settings.properties, ['id']);
  });
});

describe('the fields a layout lets the reader choose', () => {
  it('leave the fixed columns of the list, the date-laid-out timeline and the long ones of the calendar', () => {
    assert.ok(!fieldChoices('list', features).includes('status'));
    assert.ok(!fieldChoices('list', features).includes('labels'));
    assert.ok(fieldChoices('list', features).includes('goal'));
    assert.deepEqual(fieldChoices('timeline', features), []);
    assert.deepEqual(fieldChoices('calendar', features).sort(), [
      'assignee',
      'goal',
      'id',
      'priority',
      'type',
    ]);
  });

  it('hide the estimates while the project has them off', () => {
    assert.ok(!fieldChoices('table', features).includes('estimatePoints'));
    const on = { ...features, pointsEstimate: true } as ProjectFeatureSet;
    assert.ok(fieldChoices('table', on).includes('estimatePoints'));
  });
});
