import type { MatrixEscalation } from '@/lib/api/endpoints/modelMatrix';

// What a matrix cell knows about an escalation, whichever shape the server sent. The policy
// of the runner (121d, docs/helena-decisions: `target` claude|codex, `model`, `afterFailures`
// 0–5, `onResumeLimit`, `onRequest`, `maxDepth`) and the first draft of the matrix
// (`target: "runtime:codex/gpt-6-sol"`, `failures`, `stalledSteps`, `onRequest`) are both
// read. A value is written back in the shape it came in, so an older server accepts it.
export type EscalationTarget = 'claude' | 'codex';
export interface EscalationView {
  shape: 'policy' | 'draft';
  target: EscalationTarget | null;
  model: string | null;
  afterFailures: number;
  onResumeLimit: boolean;
  onRequest: boolean;
  // An agent (not a runtime) is the target: the cell can say so, not name it.
  toAgent: boolean;
}
export const DEFAULT_ESCALATION_MODEL: Record<EscalationTarget, string> = {
  codex: 'gpt-6.1-sol',
  claude: 'claude-opus-5-5',
};

const whole = (value: unknown, max: number) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(0, Math.round(value)))
    : 0;

export function readEscalation(raw: unknown): EscalationView {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const policy = 'afterFailures' in value || 'onResumeLimit' in value || 'maxDepth' in value;
  if (policy) {
    const target = value.target === 'claude' || value.target === 'codex' ? value.target : 'codex';
    return {
      shape: 'policy',
      target,
      model: typeof value.model === 'string' && value.model ? value.model : null,
      afterFailures: whole(value.afterFailures, 5),
      onResumeLimit: value.onResumeLimit === true,
      onRequest: value.onRequest === true,
      toAgent: false,
    };
  }
  const draft = typeof value.target === 'string' ? value.target : '';
  const runtime = /^runtime:(claude|codex)(?:\/(.+))?$/.exec(draft);
  return {
    shape: 'draft',
    target: runtime ? (runtime[1] as EscalationTarget) : null,
    model: runtime?.[2] ?? null,
    afterFailures: whole(value.failures, 5),
    onResumeLimit: whole(value.stalledSteps, 100) > 0,
    onRequest: value.onRequest === true,
    toAgent: /^agent:[1-9]\d*$/.test(draft),
  };
}

// Whether nothing triggers an escalation any more.
export function escalationOff(view: EscalationView): boolean {
  if (view.shape === 'draft' && !view.target && !view.toAgent) return true;
  return view.afterFailures === 0 && !view.onResumeLimit && !view.onRequest;
}

export function writeEscalation(view: EscalationView): MatrixEscalation {
  if (view.shape === 'policy') {
    const off = escalationOff(view);
    return {
      target: view.target ?? 'codex',
      model: view.model,
      afterFailures: view.afterFailures,
      onResumeLimit: view.onResumeLimit,
      onRequest: view.onRequest,
      maxDepth: off ? 0 : 1,
    };
  }
  return {
    target: view.target ? `runtime:${view.target}${view.model ? `/${view.model}` : ''}` : null,
    failures: view.afterFailures,
    stalledSteps: view.onResumeLimit ? 12 : 0,
    onRequest: view.onRequest,
  };
}

export function escalationOn(view: EscalationView, on: boolean): EscalationView {
  if (!on) return { ...view, afterFailures: 0, onResumeLimit: false, onRequest: false };
  const target = view.target ?? 'codex';
  return {
    ...view,
    target,
    model: view.model ?? DEFAULT_ESCALATION_MODEL[target],
    afterFailures: view.afterFailures || 2,
    onResumeLimit: true,
    onRequest: true,
  };
}

// The triggers that are on, in the order the cell names them.
export function escalationTriggers(view: EscalationView): ('failures' | 'stalled' | 'request')[] {
  return [
    ...(view.afterFailures > 0 ? (['failures'] as const) : []),
    ...(view.onResumeLimit ? (['stalled'] as const) : []),
    ...(view.onRequest ? (['request'] as const) : []),
  ];
}
