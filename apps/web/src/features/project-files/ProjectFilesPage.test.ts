import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectFileChild, projectFileParent } from './projectFilePath';

test('builds project-relative breadcrumb paths only', () => {
  assert.equal(projectFileChild('Notes', 'decision.md'), 'Notes/decision.md');
  assert.equal(projectFileParent('Notes/2026/decision.md'), 'Notes/2026');
  assert.equal(projectFileParent('Notes'), '');
});
