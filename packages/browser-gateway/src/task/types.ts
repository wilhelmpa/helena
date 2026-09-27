// The shapes of browser_task (docs/helena-decisions/browser-task.md §3.1): what the loop observes,
// what it asks, what it does, and what it hands back. Plain data, no browser.

import type { ActionCategory } from '../agent-tool.ts';
import type { RawElement } from './page-script.ts';

// One control of the observed page, numbered 1..n across all frames for the model; `frame` and
// `id` say where the executor finds it again.
export interface PageElement extends Omit<RawElement, 'id'> {
  i: number;
  frame: number;
  id: number;
}

export interface PageObservation {
  url: string;
  title: string;
  // The text in view (main frame), redacted.
  text: string;
  dialogs: string[];
  metrics: {
    scrollY: number;
    pageHeight: number;
    viewportHeight: number;
    textLength: number;
    elements: number;
  };
  elements: PageElement[];
  omitted: number;
  // Per frame, the page key the observation was made on (freshness).
  keys: string[];
  // Labels that occur more than once ("Toggle Todo" ×3), because Jev does not count.
  repeated?: Record<string, number>;
  // Whether the tab shows a JavaScript dialog (alert/confirm/prompt) right now.
  jsDialog: string | null;
}

// The operations the loop offers. jev-ultrafast's set plus PRESS_ENTER (jev-browser), which
// submits a search field without a visible button.
export const OPERATIONS = [
  'CLICK',
  'TYPE_TEXT',
  'SELECT',
  'PRESS_ENTER',
  'SCROLL_DOWN',
  'SCROLL_UP',
  'WAIT',
  'DONE',
  'BLOCKED',
] as const;
export type Operation = (typeof OPERATIONS)[number];

export type TaskMode = 'read' | 'act';
export type PolicyKind = 'jev' | 'laya';

export interface TaskSuccess {
  // All supplied criteria must match a fresh observation. Exact URL, visible text substrings,
  // and unique field labels with exact values; no JavaScript or selectors.
  url?: string;
  textIncludes?: string[];
  fields?: { label: string; value?: string; checked?: boolean }[];
}

export interface TaskInput {
  goal: string;
  // The strings the task may type or choose, by a meaningful key ({email, postal_code}). Never
  // generated: what is not here is not typed.
  values: Record<string, string>;
  mode: TaskMode;
  maxSteps: number;
  allowIrreversible: boolean;
  success?: TaskSuccess;
}

// What the loop decided to do next.
export interface PlannedAction {
  operation: Operation;
  element: PageElement | null;
  // The key of `values` to type or the option to select.
  valueKey?: string;
  value?: string;
  option?: string;
  probability: number;
  confidence: number;
}

// One step as it is reported back and stored: never a typed value, only its key.
export interface TaskStep {
  n: number;
  operation: Operation;
  element: string | null;
  valueKey?: string;
  option?: string;
  probability: number;
  confidence: number;
  // Milliseconds the decision took (backend round trip) and the action itself.
  decisionMs: number;
  actionMs: number;
  category: ActionCategory;
  url: string;
  // What happened: done, the page changed, or why nothing happened.
  outcome: string;
}

export type TaskStatus =
  | 'done'
  | 'likely_done'
  | 'needs_agent'
  | 'needs_login'
  | 'needs_confirmation'
  | 'needs_approval'
  | 'denied'
  | 'blocked'
  | 'error'
  | 'stuck'
  | 'max_steps'
  | 'owner_took_over'
  | 'backend_error'
  | 'cancelled';

export interface TaskCandidate {
  element: string;
  probability: number;
}

export interface TaskUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  decisionMs: number;
  // The model the backend reported (e.g. jev-1.13.0), the last one seen.
  model: string | null;
}

export interface TaskResult {
  status: TaskStatus;
  summary: string;
  url: string;
  title: string;
  steps: TaskStep[];
  usage: TaskUsage;
  durationMs: number;
  // The last decision's confidence in its operation.
  confidence: number | null;
  doneScore: number | null;
  candidates?: TaskCandidate[];
  pageText?: string;
  // Freigaben card an approval-needing action filed.
  approvalId?: number | null;
  // The action the task stopped before (needs_confirmation / needs_approval).
  pending?: { operation: Operation; element: string | null; category?: ActionCategory };
}

// The System One wire format (TypeSafe's `/v1/systemone`, also spoken by Laya servers).
export type Question =
  | { type: 'noul'; instructions: unknown; criteria?: { true?: unknown; false?: unknown } }
  | { type: 'choice'; instructions: unknown; criteria: Record<string, unknown> }
  | { type: 'score'; instructions: unknown; criteria: unknown[] };

export interface ChoiceAnswer {
  type?: 'choice';
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface NoulAnswer {
  type?: 'noul';
  noul: number;
}

export interface SystemOneResponse {
  model?: string;
  answers: Record<string, unknown>;
  usage?: { input_tokens?: number; output_tokens?: number };
}
