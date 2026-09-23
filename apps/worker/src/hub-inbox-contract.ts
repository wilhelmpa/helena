export type InboxChannel = 'mail' | 'whatsapp';

export interface InboxTriageResult {
  summary: string;
  priority: 'low' | 'medium' | 'high' | 'urgent' | null;
  requiresAction: boolean;
  projectKey: string | null;
  issueIdentifier: string | null;
  confidence: number;
}

export type InboxTriageResponse =
  | { status: 'queued' | 'running'; runId: string }
  | { status: 'completed'; result: InboxTriageResult }
  | { status: 'failed'; error: string };

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid response');
  return value as Record<string, unknown>;
};

const text = (value: unknown, max: number, required = true): string => {
  if (typeof value !== 'string' || (required && value.trim().length === 0))
    throw new Error('Invalid response');
  return value.slice(0, max);
};

const nullableText = (value: unknown, max: number): string | null =>
  value == null ? null : text(value, max, false) || null;

export function parseTriageResponse(value: unknown): InboxTriageResponse {
  const root = object(value);
  if (root.status === 'queued' || root.status === 'running') {
    return { status: root.status, runId: text(root.runId, 512) };
  }
  if (root.status === 'failed') {
    return { status: 'failed', error: text(root.error ?? 'Triage failed', 500, false) };
  }
  if (root.status !== 'completed') throw new Error('Invalid triage response');
  const result = object(root.result);
  const priority = result.priority;
  if (
    priority !== null &&
    priority !== undefined &&
    priority !== 'low' &&
    priority !== 'medium' &&
    priority !== 'high' &&
    priority !== 'urgent'
  )
    throw new Error('Invalid triage response');
  if (typeof result.requiresAction !== 'boolean') throw new Error('Invalid triage response');
  if (typeof result.confidence !== 'number' || result.confidence < 0 || result.confidence > 1)
    throw new Error('Invalid triage response');
  return {
    status: 'completed',
    result: {
      summary: text(result.summary ?? '', 1000, false),
      priority: priority ?? null,
      requiresAction: result.requiresAction,
      projectKey: nullableText(result.projectKey, 32)?.toUpperCase() ?? null,
      issueIdentifier: nullableText(result.issueIdentifier, 80)?.toUpperCase() ?? null,
      confidence: result.confidence,
    },
  };
}
