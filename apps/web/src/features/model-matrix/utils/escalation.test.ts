import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  escalationOff,
  escalationOn,
  escalationTriggers,
  readEscalation,
  writeEscalation,
} from './escalation';

describe('Eskalation in der Matrix: beide Formen lesen, in der gelesenen Form schreiben', () => {
  test('liest die Richtlinie des Runners (121d)', () => {
    const view = readEscalation({
      target: 'claude',
      model: 'claude-opus-5-5',
      afterFailures: 2,
      onResumeLimit: true,
      onRequest: false,
      maxDepth: 1,
    });
    assert.equal(view.shape, 'policy');
    assert.equal(view.target, 'claude');
    assert.equal(view.model, 'claude-opus-5-5');
    assert.deepEqual(escalationTriggers(view), ['failures', 'stalled']);
    assert.equal(escalationOff(view), false);
  });

  test('liest den ersten Entwurf und behält dessen Form beim Schreiben', () => {
    const raw = {
      target: 'runtime:codex/gpt-6-sol',
      failures: 2,
      stalledSteps: 12,
      onRequest: true,
    };
    const view = readEscalation(raw);
    assert.equal(view.shape, 'draft');
    assert.equal(view.target, 'codex');
    assert.equal(view.model, 'gpt-6-sol');
    assert.deepEqual(escalationTriggers(view), ['failures', 'stalled', 'request']);
    assert.deepEqual(writeEscalation(view), raw);
  });

  test('aus heißt: kein Auslöser mehr, und der Entwurf ohne Ziel ist aus', () => {
    assert.equal(
      escalationOff(
        readEscalation({ target: null, failures: 0, stalledSteps: 0, onRequest: true }),
      ),
      true,
    );
    const policy = readEscalation({
      target: 'codex',
      model: null,
      afterFailures: 0,
      onResumeLimit: false,
      onRequest: false,
      maxDepth: 0,
    });
    assert.equal(escalationOff(policy), true);
  });

  test('einschalten setzt sinnvolle Auslöser, ausschalten nimmt alle weg', () => {
    const off = readEscalation({
      target: 'codex',
      model: null,
      afterFailures: 0,
      onResumeLimit: false,
      onRequest: false,
      maxDepth: 0,
    });
    const on = escalationOn(off, true);
    assert.equal(on.afterFailures, 2);
    assert.equal(on.onResumeLimit, true);
    assert.deepEqual(writeEscalation(on), {
      target: 'codex',
      model: 'gpt-6.1-sol',
      afterFailures: 2,
      onResumeLimit: true,
      onRequest: true,
      maxDepth: 1,
    });
    const again = writeEscalation(escalationOn(on, false));
    assert.equal(again.maxDepth, 0);
    assert.equal(again.afterFailures, 0);
  });

  test('unbekannte Felder und Ziele auf einen Agenten zeigen keine Rohwerte', () => {
    const view = readEscalation({
      target: 'agent:7',
      failures: 1,
      stalledSteps: 0,
      onRequest: false,
      secret: 'x',
    });
    assert.equal(view.toAgent, true);
    assert.equal(view.target, null);
    assert.equal(escalationOff(view), false);
    assert.equal(readEscalation(null).afterFailures, 0);
  });
});
