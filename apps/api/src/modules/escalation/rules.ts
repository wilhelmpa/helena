// Escalation rules (docs/plan-lokal-halogen.md, Phase 2; docs/helena-decisions/halogen.md §8):
// Helena's everyday work runs on the local model (Qwen3.8-Flash-Next on Halogen); a strong
// subscription model (Opus, gpt-6-sol) takes over for work of a hard kind, when the local
// answer is unsure, or after the local model failed. Set in Helena as one setting
// (app_setting `helena.escalation`); off until the owner switches it on.
//
// This module is pure: the settings as Helena keeps them and the one decision `escalate()`
// that a run's claim (and later the central runtime) asks. Nothing calls it yet: Phase 2 wires
// it in, class by class, after its evals.

// Kinds of work that always go to a strong model (the plan's list).
export type EscalationKind = 'coding' | 'architecture' | 'security' | 'legal' | 'external-text';

export const ESCALATION_KINDS: readonly EscalationKind[] = [
  'coding',
  'architecture',
  'security',
  'legal',
  'external-text',
];

// What counts as a failure of the local model.
export type EscalationFailure = 'tests-failed' | 'loop' | 'timeout' | 'error';

export const ESCALATION_FAILURES: readonly EscalationFailure[] = [
  'tests-failed',
  'loop',
  'timeout',
  'error',
];

// A fixed choice for an agent, a project or a task: `local` never escalates, `strong` always
// runs on the strong model, `auto` follows the rules.
export type EscalationPinMode = 'auto' | 'local' | 'strong';

export interface EscalationPin {
  scope: 'agent' | 'project' | 'task';
  id: number;
  mode: EscalationPinMode;
  // The strong model for `strong` (null: the rule's or the default).
  model: string | null;
}

export interface EscalationSettings {
  enabled: boolean;
  // The strong model when a rule names none (a model id of the runtimes' catalogs).
  defaultModel: string;
  kinds: { kind: EscalationKind; enabled: boolean; model: string | null }[];
  uncertainty: { enabled: boolean; threshold: number; model: string | null };
  failure: {
    enabled: boolean;
    on: EscalationFailure[];
    // Tries on the local model before the strong one takes over (with the history so far).
    localAttempts: number;
    model: string | null;
  };
  pins: EscalationPin[];
}

export const DEFAULT_ESCALATION: EscalationSettings = {
  enabled: false,
  defaultModel: 'gpt-6-sol',
  kinds: [
    { kind: 'coding', enabled: true, model: 'gpt-6-sol' },
    { kind: 'architecture', enabled: true, model: 'claude-opus-5-5' },
    { kind: 'security', enabled: true, model: 'claude-opus-5-5' },
    { kind: 'legal', enabled: true, model: 'claude-opus-5-5' },
    { kind: 'external-text', enabled: true, model: 'claude-opus-5-5' },
  ],
  uncertainty: { enabled: true, threshold: 0.8, model: null },
  failure: {
    enabled: true,
    on: ['tests-failed', 'loop', 'timeout'],
    localAttempts: 1,
    model: null,
  },
  pins: [],
};

const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:+@/-]{0,199}$/;

function model(value: unknown): string | null {
  return typeof value === 'string' && MODEL.test(value.trim()) ? value.trim() : null;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

// A stored setting as Helena uses it: unknown fields dropped, missing ones defaulted, every
// kind present once in the fixed order.
export function normalizeEscalation(value: unknown): EscalationSettings {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const base = DEFAULT_ESCALATION;
  const storedKinds = Array.isArray(raw.kinds) ? (raw.kinds as Record<string, unknown>[]) : [];
  const kinds = base.kinds.map((entry) => {
    const stored = storedKinds.find((item) => item && item.kind === entry.kind);
    return stored
      ? {
          kind: entry.kind,
          enabled: bool(stored.enabled, entry.enabled),
          model: stored.model === null ? null : (model(stored.model) ?? entry.model),
        }
      : { ...entry };
  });
  const u = (raw.uncertainty ?? {}) as Record<string, unknown>;
  const threshold = Number(u.threshold);
  const f = (raw.failure ?? {}) as Record<string, unknown>;
  const attempts = Number(f.localAttempts);
  const on = Array.isArray(f.on)
    ? ESCALATION_FAILURES.filter((item) => (f.on as unknown[]).includes(item))
    : [...base.failure.on];
  const pins = (Array.isArray(raw.pins) ? (raw.pins as Record<string, unknown>[]) : [])
    .filter(
      (pin) =>
        pin &&
        (pin.scope === 'agent' || pin.scope === 'project' || pin.scope === 'task') &&
        typeof pin.id === 'number' &&
        Number.isInteger(pin.id) &&
        pin.id > 0 &&
        (pin.mode === 'auto' || pin.mode === 'local' || pin.mode === 'strong'),
    )
    .map((pin) => ({
      scope: pin.scope as EscalationPin['scope'],
      id: pin.id as number,
      mode: pin.mode as EscalationPinMode,
      model: model(pin.model),
    }))
    // One pin per scope and id: the last one wins.
    .filter(
      (pin, index, all) =>
        !all.some(
          (other, later) => later > index && other.scope === pin.scope && other.id === pin.id,
        ),
    )
    .slice(0, 500);
  return {
    enabled: raw.enabled === true,
    defaultModel: model(raw.defaultModel) ?? base.defaultModel,
    kinds,
    uncertainty: {
      enabled: bool(u.enabled, base.uncertainty.enabled),
      threshold:
        Number.isFinite(threshold) && threshold > 0 && threshold < 1
          ? threshold
          : base.uncertainty.threshold,
      model: model(u.model),
    },
    failure: {
      enabled: bool(f.enabled, base.failure.enabled),
      on,
      localAttempts:
        Number.isInteger(attempts) && attempts >= 0 && attempts <= 5
          ? attempts
          : base.failure.localAttempts,
      model: model(f.model),
    },
    pins,
  };
}

// A change: any part, and within the uncertainty and failure rules any field.
export type EscalationPatch = Partial<Omit<EscalationSettings, 'uncertainty' | 'failure'>> & {
  uncertainty?: Partial<EscalationSettings['uncertainty']>;
  failure?: Partial<EscalationSettings['failure']>;
};

// What is known about a piece of work when it starts (or fails).
export interface EscalationInput {
  agentId: number | null;
  projectId: number | null;
  taskId: number | null;
  // The kinds the work was classified as (a decision class, the task's labels); none: unknown.
  kinds?: readonly EscalationKind[];
  // How sure the local classification (or answer) is, 0–1; null: not asked.
  confidence?: number | null;
  // The local model's failure so far, and how often it has tried.
  failure?: EscalationFailure | null;
  localAttempts?: number;
}

export type EscalationReason =
  'off' | 'pinned-local' | 'pinned-strong' | 'kind' | 'uncertain' | 'failed' | 'none';

export interface EscalationDecision {
  // The strong model the work goes to, or null: it stays local.
  model: string | null;
  reason: EscalationReason;
  // The kind or failure that decided it, for the run's model check and the weekly numbers.
  detail: string | null;
}

// The pin of the narrowest scope wins: task over agent over project.
function pinFor(settings: EscalationSettings, input: EscalationInput): EscalationPin | null {
  const find = (scope: EscalationPin['scope'], id: number | null) =>
    id === null
      ? null
      : (settings.pins.find((pin) => pin.scope === scope && pin.id === id) ?? null);
  return (
    find('task', input.taskId) ??
    find('agent', input.agentId) ??
    find('project', input.projectId) ??
    null
  );
}

export function escalate(settings: EscalationSettings, input: EscalationInput): EscalationDecision {
  if (!settings.enabled) return { model: null, reason: 'off', detail: null };
  const pin = pinFor(settings, input);
  if (pin?.mode === 'local') return { model: null, reason: 'pinned-local', detail: pin.scope };
  if (pin?.mode === 'strong')
    return {
      model: pin.model ?? settings.defaultModel,
      reason: 'pinned-strong',
      detail: pin.scope,
    };
  const failure = settings.failure;
  if (
    failure.enabled &&
    input.failure &&
    failure.on.includes(input.failure) &&
    (input.localAttempts ?? 1) >= failure.localAttempts
  ) {
    return {
      model: failure.model ?? settings.defaultModel,
      reason: 'failed',
      detail: input.failure,
    };
  }
  for (const kind of input.kinds ?? []) {
    const rule = settings.kinds.find((entry) => entry.kind === kind && entry.enabled);
    if (rule) return { model: rule.model ?? settings.defaultModel, reason: 'kind', detail: kind };
  }
  const confidence = input.confidence;
  if (
    settings.uncertainty.enabled &&
    typeof confidence === 'number' &&
    confidence < settings.uncertainty.threshold
  ) {
    return {
      model: settings.uncertainty.model ?? settings.defaultModel,
      reason: 'uncertain',
      detail: confidence.toFixed(2),
    };
  }
  return { model: null, reason: 'none', detail: null };
}
