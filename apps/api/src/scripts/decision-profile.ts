import { localModelId } from '@helena/sdk';
import { JEV_UNVALIDATED_CLASSES } from '../modules/decisions/jev-policy';

export const DECISION_THRESHOLDS: Record<string, number> = {
  'helena.model-router': 0.8,
  'helena.mail': 0.7,
  'helena.receipts': 0.95,
  'helena.general': 0.7,
  'helena.browser': 0.95,
  'tasks.triage': 0.85,
  'agents.routing': 0.85,
  'helena.trading.news': 0.7,
  'helena.trading.rules': 0.85,
  'helena.trading.routing': 0.7,
};

export const LOCAL_ONLY_CLASSES: Record<string, number> = {
  'helena.routine.gate': 0.8,
  'routines.precheck': 0.8,
};

type ClassRow = {
  enabled: boolean;
  credentialId: number | null;
  fallbackCredentialId: number | null;
  threshold: number | null;
  timeoutMs: number | null;
};

export function decisionProfile(
  classes: Record<string, ClassRow>,
  firstStage: Record<string, unknown> | null,
  policy: Record<string, unknown> | null,
  halogenModel: string,
  npuModel: string | null,
) {
  const classSettings = Object.fromEntries(
    Object.entries({ ...DECISION_THRESHOLDS, ...LOCAL_ONLY_CLASSES }).map(([id, threshold]) => [
      id,
      {
        enabled: classes[id]?.enabled ?? true,
        credentialId: classes[id] ? classes[id].credentialId : 36,
        fallbackCredentialId: classes[id]?.fallbackCredentialId ?? null,
        threshold: classes[id] ? classes[id].threshold : threshold,
        timeoutMs: classes[id]
          ? classes[id].timeoutMs
          : id === 'helena.mail'
            ? 15_000
            : id === 'helena.trading.news'
              ? 10_000
              : null,
      },
    ]),
  );
  const useCases = { ...(firstStage?.useCases as Record<string, unknown> | undefined) };
  for (const id of Object.keys(DECISION_THRESHOLDS))
    useCases[id] ??= { enabled: true, cloudAllowed: true };
  for (const id of JEV_UNVALIDATED_CLASSES) useCases[id] = { enabled: false, cloudAllowed: false };
  for (const id of Object.keys(LOCAL_ONLY_CLASSES))
    useCases[id] = { enabled: false, cloudAllowed: false };
  const stage = { enabled: true, credentialId: 46, timeoutMs: 1000, ...firstStage, useCases };
  const existingClasses = { ...(policy?.classes as Record<string, unknown> | undefined) };
  const classesNext = { ...existingClasses };
  for (const [id, entry] of Object.entries(existingClasses)) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as { mode?: unknown; model?: unknown };
    if (typeof item.model !== 'string' || !/Qwen3\.6/i.test(item.model)) continue;
    const replacement =
      npuModel && ['triage', 'routines', 'hermes-helpers'].includes(id) ? npuModel : halogenModel;
    classesNext[id] = { ...item, model: replacement };
  }
  classesNext.decisions = { mode: 'prefer', model: halogenModel };
  const localPolicy: Record<string, unknown> = { ...policy, classes: classesNext };
  return { classSettings, stage, localPolicy };
}

export function availableModel(
  slug: string,
  models: { id: string; capabilities: string[]; loaded?: boolean; downloaded?: boolean | null }[],
) {
  const model =
    models.find((entry) => entry.capabilities.includes('chat') && entry.loaded) ??
    models.find((entry) => entry.capabilities.includes('chat') && entry.downloaded !== false);
  return model ? localModelId(slug, model.id) : null;
}
