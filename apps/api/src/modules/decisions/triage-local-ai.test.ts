import { expect, test } from 'bun:test';
import { decisionAttempts } from './attempts';
import {
  AGENT_ROUTING_CLASS,
  BUILTIN_DECISION_CLASSES,
  HEARTBEAT_PRECHECK_CLASS,
  MAIL_CLASS,
  TASK_TRIAGE_CLASS,
  localAiClassForDecision,
} from './classes';
import { BUILTIN_TASK_CLASSES } from '#modules/local-ai/task-classes';

test('mail and task assignment use the Flash decision route with a cloud first stage', () => {
  for (const classId of [MAIL_CLASS, TASK_TRIAGE_CLASS, AGENT_ROUTING_CLASS]) {
    expect(localAiClassForDecision(classId)).toBe('decisions');
    expect(BUILTIN_DECISION_CLASSES.find((entry) => entry.id === classId)?.input.cloud).toBe(
      'allowed',
    );
  }
  expect(localAiClassForDecision(HEARTBEAT_PRECHECK_CLASS)).toBe('decisions');
  expect(BUILTIN_TASK_CLASSES.find((entry) => entry.id === 'triage')).toMatchObject({
    wired: true,
    unit: 'gpu',
    modes: ['off', 'prefer'],
  });
  expect(decisionAttempts(undefined, 3, 5)).toEqual([
    { credentialId: 3, role: 'regular' },
    { credentialId: 5, role: 'regular' },
  ]);
});
