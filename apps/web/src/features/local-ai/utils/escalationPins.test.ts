import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { EscalationPin } from '@/lib/api/endpoints/localAi';
import { pinsWithAgent } from './escalationPins';

const project: EscalationPin = { scope: 'project', id: 7, mode: 'local', model: null };

describe('Eskalation: Festlegung für einen Agenten', () => {
  test('setzt, ändert und entfernt nur die Festlegung dieses Agenten', () => {
    const strong = pinsWithAgent([project], 3, 'strong', 'claude-opus-5-5');
    assert.deepEqual(strong, [
      project,
      { scope: 'agent', id: 3, mode: 'strong', model: 'claude-opus-5-5' },
    ]);
    const local = pinsWithAgent(strong, 3, 'local', 'ignored');
    assert.deepEqual(local, [project, { scope: 'agent', id: 3, mode: 'local', model: null }]);
    assert.deepEqual(pinsWithAgent(local, 3, 'auto', null), [project]);
  });
});
