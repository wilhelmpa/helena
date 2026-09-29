import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { PipelineDefinition } from '@/lib/api/endpoints/pipelines';
import { flowSummary } from './flowSummary';

const step = (name: string) => ({ id: name, name, type: 'wait' }) as never;

describe('Workflow auf einen Blick', () => {
  test('Schritte in ihrer Reihenfolge, der Rest gezählt', () => {
    const definition = { steps: ['Plan', 'Umsetzen', 'Prüfen'].map(step) } as PipelineDefinition;
    assert.deepEqual(flowSummary(definition), { names: ['Plan', 'Umsetzen', 'Prüfen'], more: 0 });
    assert.deepEqual(flowSummary(definition, 2), { names: ['Plan', 'Umsetzen'], more: 1 });
  });
});
