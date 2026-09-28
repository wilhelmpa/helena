import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activeToolFromEvents } from './useOrganizationToolStates';

test('Werkzeugzustand endet erst mit dem echten Ergebnis', () => {
  assert.equal(
    activeToolFromEvents([
      { type: 'TOOL_CALL_START', toolCallId: 'one' },
      { type: 'TOOL_CALL_END', toolCallId: 'one' },
    ]),
    true,
  );
  assert.equal(
    activeToolFromEvents([
      { type: 'TOOL_CALL_START', toolCallId: 'one' },
      { type: 'TOOL_CALL_RESULT', toolCallId: 'one' },
    ]),
    false,
  );
  assert.equal(
    activeToolFromEvents([{ type: 'TOOL_CALL_START', toolCallId: 'one' }, { type: 'RUN_ERROR' }]),
    false,
  );
});
