import { expect, it } from 'bun:test';
import { decisionOptionIds, decisionQuestionProblem } from '@helena/sdk';
import { splitDecisionCases } from '@helena/decisions';
import { BUILTIN_DECISION_CLASSES } from './builtin-classes';
import { AVA_COMMAND_CLASS } from './ava-questions';
import { TOOL_SELECTION_CLASS } from './tool-selection-questions';
import { AVA_COMMAND_EVAL } from './evals/ava-befehle';
import { TOOL_SELECTION_EVAL } from './evals/tool-selection';
import { MEASUREMENT_CLASSES } from './measurement-classes';
import { heartbeatPrecheckQuestions, routineGateQuestions } from './questions';
import { stageContext, stageQuestions, FIRST_STAGE_READINESS } from './stage-questions';

it('measures the twelve frozen classes with valid production questions and unchanged expected labels', () => {
  expect(new Set(MEASUREMENT_CLASSES.map((entry) => entry.name)).size).toBe(12);
  for (const { definition } of MEASUREMENT_CLASSES) {
    const cases = definition.eval!.cases;
    expect(new Set(cases.map((entry) => entry.id)).size).toBe(cases.length);
    const split = splitDecisionCases(cases.map((entry) => entry.id));
    expect(split.tuning.length + split.check.length).toBe(cases.length);
    for (const entry of cases) {
      for (const [id, expected] of Object.entries(entry.expected)) {
        const question = entry.questions[id]!;
        expect(decisionQuestionProblem(question)).toBeNull();
        for (const label of [expected].flat()) expect(decisionOptionIds(question)).toContain(label);
      }
    }
  }
});

it('shares gate questions between production and evals, with counts and conservative uncertainty', () => {
  const routine = MEASUREMENT_CLASSES.find((entry) => entry.name === 'routine-gate')!;
  for (const entry of routine.definition.eval!.cases)
    expect(entry.questions).toEqual(routineGateQuestions());
  expect(routineGateQuestions().run.question).toContain('counts');
  const question = heartbeatPrecheckQuestions('Worker').work.question;
  expect(question).toContain('absent due date alone is insufficient');
  expect(question).toContain('Say yes when evidence is empty');
});

it('uses the same readiness evidence without mutating the requested questions or context', () => {
  const questions = routineGateQuestions();
  const original = structuredClone(questions);
  const context = { title: 'Example' };
  const staged = stageQuestions(questions);
  expect(staged[FIRST_STAGE_READINESS]).toBeDefined();
  expect(stageContext(context, questions)).toEqual({
    title: 'Example',
    __helena_judgments: questions,
  });
  expect(stageContext('Text', questions)).toEqual({ text: 'Text', __helena_judgments: questions });
  expect(questions).toEqual(original);
  expect(context).toEqual({ title: 'Example' });
});

it('keeps unmeasured release classes and their evals available without adding them to calibration', () => {
  for (const [id, evaluation] of [
    [AVA_COMMAND_CLASS, AVA_COMMAND_EVAL],
    [TOOL_SELECTION_CLASS, TOOL_SELECTION_EVAL],
  ] as const) {
    expect(BUILTIN_DECISION_CLASSES.find((entry) => entry.id === id)?.eval).toBe(evaluation);
    expect(MEASUREMENT_CLASSES.some((entry) => entry.definition.id === id)).toBe(false);
  }
  expect(MEASUREMENT_CLASSES.every((entry) => typeof entry.name === 'string')).toBe(true);
});
