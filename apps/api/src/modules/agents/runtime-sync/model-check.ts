import { isLocalProvider, parseLocalModelId } from '@helena/sdk';
import type { modelCheck, runModelReport } from './model';

// The model and reasoning a run or chat answer was configured with, next to what its
// session really ran on, as the runner read them back (runner: RunModelReport).

export type RunModelReport = typeof runModelReport.static;
export type ModelCheck = typeof modelCheck.static;

// A model id without its provider prefix and release date: claude-haiku-4-5-20251001 and
// anthropic/claude-haiku-4-5 are claude-haiku-4-5.
function modelKey(model: string): string {
  return model
    .trim()
    .toLowerCase()
    .replace(/^.*\//, '')
    .replace(/-\d{8}$/, '');
}

// Whether a session ran on the configured model. An alias names a family ("opus" is
// claude-opus-5), so the model it resolved to only has to contain it.
export function sameModel(configured: string, used: string): boolean {
  const want = modelKey(configured);
  const got = modelKey(used);
  if (want === got) return true;
  return /^[a-z]+$/.test(want) && got.split(/[-_.]/).includes(want);
}

// The configured model and reasoning of a run or chat answer next to what its session
// used. `ownModel` is set when the run names a model of its own (a workflow step).
export function modelCheckOf(
  report: RunModelReport | undefined,
  ownModel: string | null = null,
): ModelCheck | null {
  if (!report) return null;
  const model = report.requested.model ?? report.defaults?.model ?? null;
  const reasoning = report.requested.reasoning ?? report.defaults?.reasoning ?? null;
  const source = ownModel ? 'run' : report.requested.model ? 'agent' : 'default';
  const used = report.used;
  const mismatch: ModelCheck['mismatch'] = [];
  // A local model that another answered for: Hermes moved to its fallback (the configured
  // cloud model) because the local server failed. The fallback working is no mismatch.
  const fellBack =
    model !== null &&
    parseLocalModelId(model) !== null &&
    !!used?.model &&
    !sameModel(model, used.model) &&
    !isLocalProvider(used.provider);
  if (model && used?.model && !sameModel(model, used.model) && !fellBack) mismatch.push('model');
  if (reasoning && used?.reasoning && reasoning.toLowerCase() !== used.reasoning.toLowerCase()) {
    mismatch.push('reasoning');
  }
  return {
    configured: { model, reasoning, source },
    used,
    mismatch,
    ...(fellBack && model ? { fallback: { from: model, reason: 'failed' as const } } : {}),
  };
}

// A check computed from the runner's report, with what the claim already recorded kept: a
// fallback (local AI off or its server not answering when the run or answer started), and
// that Lokale KI chose the local model for the run's kind of work.
export function withStoredFallback(check: ModelCheck | null, stored: unknown): ModelCheck | null {
  const claimed = stored as Partial<ModelCheck> | null;
  if (!check || !claimed) return check;
  const fallback = claimed.fallback;
  const workClass = claimed.configured?.workClass;
  const local = claimed.configured?.source === 'local';
  if (!fallback && !workClass && !local) return check;
  return {
    ...check,
    configured: {
      ...check.configured,
      ...(local && { source: 'local' as const }),
      ...(workClass && { workClass }),
    },
    ...(fallback && !check.fallback && { fallback }),
  };
}

// What a run or chat answer is stored with when its claim decided on local AI: the configured
// model ran instead of a local one (`fallback`), or Lokale KI handed the local model for the
// run's kind of work (source `local`). The runner's report replaces it and keeps both.
export function claimedModelCheck(
  model: string | null,
  reasoning: string | null,
  source: ModelCheck['configured']['source'],
  fallback: ModelCheck['fallback'] | null,
  workClass?: string | null,
): ModelCheck {
  return {
    configured: { model, reasoning, source, ...(workClass && { workClass }) },
    used: null,
    mismatch: [],
    ...(fallback && { fallback }),
  };
}
