import type { EscalationSettings } from './config';
import type { EscalationReason } from './events';

// When the loop hands a task to a bigger model (docs/helena-decisions/zentrale-laufzeit.md §9):
// before the first step by the kind of task, the decision service's doubt or the owner's pin,
// and during the run after a failure. The target is a model this loop drives (an API-key
// model: the loop switches to it and goes on) or a runtime Helena starts as a follow-up run
// (`runtime:claude`, `runtime:codex`, optionally `/model`).

export interface Escalation {
  reason: EscalationReason;
  detail: string;
}

export function escalationTarget(settings: EscalationSettings | undefined): string | null {
  const target = settings?.target?.trim();
  return target ? target : null;
}

export function isRuntimeTarget(target: string): boolean {
  return target.startsWith('runtime:');
}

// The words a task kind is known by in the task text and its labels.
const KIND_WORDS: Record<string, RegExp> = {
  'programmierung-gross': /\b(refactor(ing)?|architektur|migration|neues modul|großes feature)\b/i,
  architektur: /\barchitektur|architecture\b/i,
  sicherheit: /\b(sicherheit|security|schwachstelle|vulnerab|cve-)\b/i,
  recht: /\b(vertrag|vertr[äa]ge|recht(lich)?|dsgvo|agb|impressum|legal)\b/i,
  aussenkommunikation:
    /\b(pressemitteilung|newsletter an|kund(en|in)mail|öffentlich(e|er)? (text|post))\b/i,
};

// Before the first step: the owner's pin, then the kinds of task that always go up.
export function preflightEscalation(
  settings: EscalationSettings | undefined,
  task: string,
  labels: string[] = [],
): Escalation | null {
  if (!settings || settings.mode === 'never' || !escalationTarget(settings)) return null;
  if (settings.mode === 'always') return { reason: 'pinned', detail: 'always' };
  const lowerLabels = labels.map((label) => label.toLowerCase());
  if (lowerLabels.includes('grosses-modell') || lowerLabels.includes('großes-modell')) {
    return { reason: 'pinned', detail: 'label grosses-modell' };
  }
  for (const kind of settings.taskKinds ?? []) {
    const key = kind.toLowerCase();
    if (lowerLabels.includes(key)) return { reason: 'task-kind', detail: key };
    const words = KIND_WORDS[key];
    if (words?.test(task)) return { reason: 'task-kind', detail: key };
  }
  return null;
}

// The decision service's answer on whether the task is too hard: below the owner's threshold
// the task goes up.
export function uncertaintyEscalation(
  settings: EscalationSettings | undefined,
  answer: { label: string; confidence: number } | null,
): Escalation | null {
  if (!answer || !settings || settings.mode === 'never' || !escalationTarget(settings)) return null;
  const threshold = settings.confidenceBelow ?? 0.8;
  if (answer.label === 'hard' || answer.label === 'schwer') {
    return { reason: 'uncertain', detail: `decision: ${answer.label}` };
  }
  if (answer.confidence < threshold) {
    return { reason: 'uncertain', detail: `confidence ${answer.confidence.toFixed(2)}` };
  }
  return null;
}

// Signs of a run going nowhere, counted as the loop goes.
export class FailureWatch {
  private readonly seen = new Map<string, number>();
  private lastSignature: string | null = null;
  private sameInRow = 0;
  private invalidSteps = 0;
  private redTests = 0;
  private testsRan = false;
  private warned = false;

  constructor(
    private readonly limits = {
      repeatSinceChange: 3,
      repeatInRow: 4,
      invalidSteps: 2,
      redTests: 3,
    },
  ) {}

  // One tool call. Returns 'loop' when it repeats a call that changed nothing, the first time
  // as a warning the loop passes to the model, afterwards as a failure.
  call(
    name: string,
    input: unknown,
    output: { changed?: boolean; test?: boolean; exitCode?: number | null },
  ): 'ok' | 'warn' | 'loop' {
    const signature = JSON.stringify([name, input]);
    this.sameInRow = signature === this.lastSignature ? this.sameInRow + 1 : 1;
    this.lastSignature = signature;
    if (output.test) {
      this.testsRan = true;
      this.redTests = output.exitCode === 0 ? 0 : this.redTests + 1;
    }
    let repeated: number;
    if (output.changed) {
      this.seen.clear();
      repeated = 1;
      this.seen.set(signature, 1);
    } else {
      repeated = (this.seen.get(signature) ?? 0) + 1;
      this.seen.set(signature, repeated);
    }
    const looping =
      repeated >= this.limits.repeatSinceChange || this.sameInRow >= this.limits.repeatInRow;
    if (!looping) return 'ok';
    if (!this.warned) {
      this.warned = true;
      this.seen.clear();
      this.sameInRow = 0;
      return 'warn';
    }
    return 'loop';
  }

  step(invalidCalls: number): boolean {
    this.invalidSteps = invalidCalls > 0 ? this.invalidSteps + 1 : 0;
    return this.invalidSteps >= this.limits.invalidSteps;
  }

  // The last test run's verdict: true green, false red, null when no test ran.
  lastTests(): boolean | null {
    return this.testsRan ? this.redTests === 0 : null;
  }

  testsFailing(): boolean {
    return this.redTests >= this.limits.redTests;
  }
}
