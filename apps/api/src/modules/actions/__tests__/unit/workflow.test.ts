import { describe, expect, it } from 'bun:test';
import {
  WorkflowValidationError,
  validateWorkflowDefinition,
  type WorkflowDefinition,
} from '../../workflow';

const workflow: WorkflowDefinition = {
  version: 1,
  nodes: [
    {
      id: 'trigger',
      type: 'trigger',
      config: { trigger: 'issue_state_changed' },
      position: { x: 0, y: 0 },
    },
    { id: 'condition', type: 'condition', config: { conditions: [] }, position: { x: 0, y: 100 } },
    { id: 'matched', type: 'action', config: { priority: 'high' }, position: { x: 0, y: 200 } },
    { id: 'other', type: 'action', config: { priority: 'low' }, position: { x: 200, y: 200 } },
  ],
  edges: [
    { id: 'a', source: 'trigger', target: 'condition', branch: 'always' },
    { id: 'b', source: 'condition', target: 'matched', branch: 'true' },
    { id: 'c', source: 'condition', target: 'other', branch: 'false' },
  ],
};

describe('workflow validation', () => {
  it('accepts bounded condition branches and allowlisted issue updates', () => {
    expect(validateWorkflowDefinition(workflow)).toEqual(workflow);
  });

  it('rejects cycles, scripts, and external request actions', () => {
    expect(() =>
      validateWorkflowDefinition({
        ...workflow,
        nodes: workflow.nodes.map((node) =>
          node.id === 'matched' ? { ...node, config: { script: 'return true' } } : node,
        ),
      }),
    ).toThrow(WorkflowValidationError);
    expect(() =>
      validateWorkflowDefinition({
        ...workflow,
        nodes: workflow.nodes.map((node) =>
          node.id === 'matched' ? { ...node, config: { url: 'https://example.com' } } : node,
        ),
      }),
    ).toThrow(WorkflowValidationError);
    expect(() =>
      validateWorkflowDefinition({
        ...workflow,
        edges: [
          ...workflow.edges,
          { id: 'cycle', source: 'matched', target: 'condition', branch: 'always' },
        ],
      }),
    ).toThrow(WorkflowValidationError);
  });
});
