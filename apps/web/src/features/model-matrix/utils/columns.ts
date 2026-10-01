import type {
  MatrixBrowser,
  MatrixColumn,
  MatrixDecisionBackend,
  MatrixDevice,
  MatrixReasoning,
  MatrixRuntime,
} from '@/lib/api/endpoints/modelMatrix';

export const RUNTIMES: MatrixRuntime[] = [
  'helena',
  'claude',
  'codex',
  'hermes',
  'command',
  'webhook',
];
export const REASONING: MatrixReasoning[] = ['low', 'medium', 'high', 'xhigh'];
export const BROWSERS: MatrixBrowser[] = ['standard', 'jev', 'combined'];
export const DEVICES: MatrixDevice[] = ['gpu', 'npu', 'cloud', 'cpu'];
export const DECISION_BACKENDS: MatrixDecisionBackend[] = [
  'jev-local',
  'local-jev',
  'jev',
  'gpu',
  'npu',
];
export const ROLES = [
  'home',
  'coordinator',
  'coder',
  'reviewer',
  'planning',
  'research',
  'content',
  'assistant',
  'finance',
  'trading',
  'browser',
  'support',
  'devops',
  'general',
] as const;
// Columns in the order of the matrix.
export const COLUMN_ORDER: MatrixColumn[] = [
  'runtime',
  'model',
  'reasoning',
  'escalation',
  'browser',
  'decision',
  'device',
];
// Runtimes that run a script or call a URL instead of a model.
export const modelless = (runtime: MatrixRuntime) => runtime === 'command' || runtime === 'webhook';
// The device follows the runtime for cloud runtimes; NPU carries only small classes, never
// an agent's runs (combo-eval 29.09.), so it is listed but not selectable.
export const NPU_AGENT_NOTE = true;

// Which catalog models belong to a runtime.
export function modelsOfRuntime<T extends { id: string }>(
  runtime: MatrixRuntime | null,
  models: T[],
  local: T[],
): T[] {
  const isLocal = (id: string) => id === 'volition-local-default' || id.startsWith('helena-');
  const all = [...new Map([...models, ...local].map((entry) => [entry.id, entry])).values()];
  // null: agents of several runtimes at once, so every model.
  if (runtime === null) return all;
  if (runtime === 'helena') return all.filter((entry) => isLocal(entry.id));
  if (runtime === 'claude') return all.filter((entry) => /^claude-/.test(entry.id));
  if (runtime === 'codex') return all.filter((entry) => /^gpt-/.test(entry.id));
  return all.filter((entry) => !isLocal(entry.id));
}

// The schemas that ship with the app, in the order they are listed; custom ones follow.
export const BUILT_IN_SCHEMAS = [
  'nur-lokal',
  'nur-lokal-27b',
  'gemischt',
  'nur-codex',
  'nur-claude',
];
