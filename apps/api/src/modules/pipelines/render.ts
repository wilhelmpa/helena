// Fills the {{…}} variables of a step's text. Validation (definition.ts) accepts only the
// names below, so an unknown one cannot reach a run; a value a run has not produced
// yet, such as the result of a step in a lane it did not take, is empty.

export interface StepResult {
  summary: string;
  outcome: string;
  note: string;
  // The result fields of a plugin's step (its type's `outputs`).
  output?: Record<string, unknown>;
}

const RESULT_FIELDS = new Set(['summary', 'outcome', 'note']);

function text(value: unknown): string {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export interface RenderContext {
  task: { title: string; description: string; identifier: string; status: string };
  previous: StepResult | null;
  steps: Record<string, StepResult>;
}

const VARIABLE = /\{\{\s*([^{}]*?)\s*\}\}/g;

function lookup(name: string, context: RenderContext): string {
  const [scope, key, field] = name.split('.');
  if (scope === 'task') return context.task[key as keyof RenderContext['task']] ?? '';
  if (scope === 'previous') return context.previous?.[key as 'summary' | 'outcome' | 'note'] ?? '';
  if (scope === 'step') {
    const result = context.steps[key];
    if (!result || !field) return '';
    return RESULT_FIELDS.has(field)
      ? (result[field as 'summary' | 'outcome' | 'note'] ?? '')
      : text(result.output?.[field]);
  }
  return '';
}

export function renderTemplate(template: string, context: RenderContext): string {
  return template.replace(VARIABLE, (_, name: string) => lookup(name, context));
}
