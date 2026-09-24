import type {
  BrowserControlPolicy,
  DecisionConnection,
  LabOptions,
  StartLabRun,
} from '@/lib/api/endpoints/browserTask';

// Browser 2.0's form and the browser control settings, without React (tested in lab.test.ts).

export function connectionLabel(connection: DecisionConnection): string {
  return connection.model ? `${connection.label} · ${connection.model}` : connection.label;
}

// A decision model threshold as typed: empty for the policy's own, else a number in (0, 1).
export function confidenceOf(text: string): number | null | undefined {
  if (text.trim() === '') return null;
  const value = Number(text.replace(',', '.'));
  return Number.isFinite(value) && value > 0 && value < 1 ? value : undefined;
}

// "standard" | "decision:<credentialId>" | "jev-browser:<credentialId>"
export type LabBackendChoice = string;

export interface LabDraft {
  goal: string;
  // One value per line, "name: value".
  values: string;
  startUrl: string;
  mode: 'act' | 'read';
  maxSteps: string;
  agentId: number | null;
  backend: LabBackendChoice;
  policy: BrowserControlPolicy;
}

export function emptyDraft(options: LabOptions | undefined): LabDraft {
  return {
    goal: '',
    values: '',
    startUrl: '',
    mode: 'act',
    maxSteps: '20',
    agentId: options?.agents[0]?.id ?? null,
    backend: options?.defaultConnectionId ? `decision:${options.defaultConnectionId}` : 'standard',
    policy: 'auto',
  };
}

export function valuesOf(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const at = line.indexOf(':');
    if (at <= 0) continue;
    const key = line.slice(0, at).trim();
    const value = line.slice(at + 1).trim();
    if (key && value) out[key.slice(0, 60)] = value.slice(0, 2000);
  }
  return out;
}

export function toStartRun(draft: LabDraft): StartLabRun | null {
  if (!draft.goal.trim() || draft.agentId === null) return null;
  const [kind, id] = draft.backend.split(':');
  // jev-browser's own browser starts empty: it needs the address to open.
  if (kind === 'jev-browser' && !/^https?:\/\//i.test(draft.startUrl.trim())) return null;
  const steps = Number.parseInt(draft.maxSteps, 10);
  return {
    backend: kind === 'decision' ? 'decision' : kind === 'jev-browser' ? 'jev-browser' : 'standard',
    agentId: draft.agentId,
    ...(id ? { credentialId: Number(id) } : {}),
    ...(kind === 'decision' ? { policy: draft.policy } : {}),
    goal: draft.goal.trim(),
    values: valuesOf(draft.values),
    startUrl: draft.startUrl.trim() || null,
    mode: draft.mode,
    maxSteps: Number.isFinite(steps) ? Math.max(1, Math.min(60, steps)) : 20,
  };
}
