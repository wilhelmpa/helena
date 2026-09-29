import { expect, test } from 'bun:test';
import { isDeepStrictEqual } from 'node:util';
import {
  availableModel,
  decisionProfile,
  DECISION_THRESHOLDS,
  LOCAL_ONLY_CLASSES,
} from './decision-profile';

test('decision profile assigns Jev first and Flash locally, including private classes', () => {
  const halogen = availableModel('halogen', [
    { id: 'halogen-qwen3.8-flash-next', capabilities: ['chat'], loaded: true },
  ])!;
  const policy = {
    classes: {
      decisions: { mode: 'prefer', model: 'helena-local/Qwen3.6-35B-A3B-MTP-GGUF' },
      triage: { mode: 'prefer', model: 'helena-local/Qwen3.6-35B-A3B-MTP-GGUF' },
      summaries: { mode: 'off', model: 'helena-local/Qwen3.6-35B-A3B-MTP-GGUF' },
    },
  };
  const first = decisionProfile({}, null, policy, halogen, null);
  expect(first.stage).toMatchObject({ enabled: true, credentialId: 46 });
  for (const [id, threshold] of Object.entries(DECISION_THRESHOLDS)) {
    expect(first.classSettings[id]).toMatchObject({ credentialId: 36, threshold, enabled: true });
    expect(first.stage.useCases[id]).toEqual({ enabled: true, cloudAllowed: true });
  }
  for (const id of Object.keys(LOCAL_ONLY_CLASSES))
    expect(first.stage.useCases[id]).toEqual({ enabled: false, cloudAllowed: false });
  expect((first.localPolicy.classes as Record<string, { model: string }>).triage.model).toBe(
    halogen,
  );
  expect((first.localPolicy.classes as Record<string, { mode: string }>).summaries.mode).toBe(
    'off',
  );
  const again = decisionProfile(first.classSettings, first.stage, first.localPolicy, halogen, null);
  expect(isDeepStrictEqual(again, first)).toBe(true);
});

test('active NPU is limited to triage, routines, and Hermes helpers', () => {
  const qwen = 'helena-local/Qwen3.6-35B-A3B-MTP-GGUF';
  const classes = Object.fromEntries(
    ['triage', 'routines', 'hermes-helpers', 'decisions', 'mail'].map((id) => [
      id,
      { mode: 'prefer', model: qwen },
    ]),
  );
  const plan = decisionProfile({}, null, { classes }, 'helena-halogen/flash', 'helena-npu/qwen');
  for (const id of ['triage', 'routines', 'hermes-helpers'])
    expect((plan.localPolicy.classes as Record<string, { model: string }>)[id].model).toBe(
      'helena-npu/qwen',
    );
  for (const id of ['decisions', 'mail'])
    expect((plan.localPolicy.classes as Record<string, { model: string }>)[id].model).toBe(
      'helena-halogen/flash',
    );
});
