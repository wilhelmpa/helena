import { describe, expect, test } from 'bun:test';
import { projectWorkflowScope } from '../../service';

describe('project workflow scope', () => {
  test('derives opaque Mastra refs only from the authenticated project', () => {
    expect(projectWorkflowScope({ id: 7, key: 'KARR', teamId: 3 })).toEqual({
      projectRef: 'project:KARR',
      organizationRef: 'organization:3',
    });
  });
});
