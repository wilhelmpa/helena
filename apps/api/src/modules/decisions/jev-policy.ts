// Thresholds use tuning cases only; failed holdout validation disables a whole class.
export const JEV_THRESHOLDS: Readonly<Record<string, number | null>> = {
  'routines.precheck': 0.141,
  'tasks.triage': 0.461,
  'agents.routing': 0,
  'helena.routine.gate': 0,
  'helena.browser': 0,
  'helena.model-router': 0,
  'helena.mail': 0.961,
  'helena.receipts': 0.95,
  'helena.general': 0,
  'helena.trading.news': 0.7,
  'helena.trading.rules': 0,
  'helena.trading.routing': 0,
};

export const JEV_UNVALIDATED_CLASSES: readonly string[] = [
  'routines.precheck',
  'tasks.triage',
  'helena.routine.gate',
  'helena.mail',
];

export function calibratedDecisionPolicy(
  calibration: number | null | undefined,
  threshold: number,
  explicitThreshold: number | null,
) {
  return {
    enabled: calibration !== null,
    threshold:
      calibration === null || calibration === undefined
        ? threshold
        : Math.max(calibration, explicitThreshold ?? 0),
  };
}

export function jevDecisionPolicy(
  classId: string,
  backendId: string,
  threshold: number,
  explicitThreshold: number | null,
) {
  const jev = ['typesafe', 'vercel'].includes(backendId);
  const policy = calibratedDecisionPolicy(
    jev ? JEV_THRESHOLDS[classId] : undefined,
    threshold,
    explicitThreshold,
  );
  return {
    ...policy,
    enabled: policy.enabled && !(jev && JEV_UNVALIDATED_CLASSES.includes(classId)),
  };
}
