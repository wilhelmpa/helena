export type InboxChannel = 'mail' | 'whatsapp';

export interface InboxSyncEvent {
  externalEventId: string;
  externalThreadId: string;
  externalMessageId: string;
  sender: string;
  subject: string;
  snippet: string;
  receivedAt: string;
}

export interface InboxSyncSource {
  channel: InboxChannel;
  account: string;
  status: 'disabled' | 'connected' | 'error';
  cursor: string | null;
  error: string | null;
  events: InboxSyncEvent[];
}

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

export function parseSyncResponse(value: unknown): InboxSyncSource[] {
  const root = object(value);
  if (!Array.isArray(root.sources) || root.sources.length > 50)
    throw new Error('Invalid sync response');
  return root.sources.map((rawSource) => {
    const source = object(rawSource);
    const channel = source.channel;
    if (channel !== 'mail' && channel !== 'whatsapp') throw new Error('Invalid sync response');
    const status = source.status;
    if (status !== 'disabled' && status !== 'connected' && status !== 'error')
      throw new Error('Invalid sync response');
    if (!Array.isArray(source.events) || source.events.length > 100)
      throw new Error('Invalid sync response');
    return {
      channel,
      account: text(source.account, 320),
      status,
      cursor: nullableText(source.cursor, 2048),
      error: nullableText(source.error, 500),
      events: source.events.map((rawEvent) => {
        const event = object(rawEvent);
        const receivedAt = text(event.receivedAt, 64);
        if (!Number.isFinite(Date.parse(receivedAt))) throw new Error('Invalid sync response');
        return {
          externalEventId: text(event.externalEventId, 512),
          externalThreadId: text(event.externalThreadId, 512),
          externalMessageId: text(event.externalMessageId, 512),
          sender: text(event.sender, 500),
          subject: text(event.subject ?? '', 500, false),
          snippet: text(event.snippet ?? '', 2000, false),
          receivedAt,
        };
      }),
    };
  });
}

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
