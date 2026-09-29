import { request } from '@/lib/api/core/client';

// The second brain: one search over every knowledge source (tasks, comments, notes and
// files, mail, chats, agent runs), what mentions an item, "save to knowledge", the daily
// note and templates. See docs/helena-decisions/second-brain.md.

export type KnowledgeSourceId = 'issue' | 'comment' | 'vault' | 'mail' | 'chat' | 'run';

export interface KnowledgeHit {
  ref: string;
  source: KnowledgeSourceId | string;
  id: string;
  title: string;
  snippet: string;
  href: string;
  url: string;
  cite: string;
  path: string | null;
  projectKey: string | null;
  mimeType: string | null;
  metadata: Record<string, unknown>;
  author: string | null;
  origin: string | null;
  runId: number | null;
  updatedAt: string;
  matched: string[];
}

export interface KnowledgeFindResult {
  items: KnowledgeHit[];
  counts: Record<string, number>;
  semantic: boolean;
}

export interface KnowledgeMention {
  ref: string;
  source: string;
  id: string;
  title: string;
  href: string;
  projectKey: string | null;
  kind: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
}

export interface CaptureInput {
  target?: 'inbox' | 'journal';
  kind?: 'text' | 'chat-message' | 'web-page' | 'mail-message' | 'issue' | 'file';
  title: string;
  text: string;
  origin?: string;
  from?: string;
  projectKey?: string;
  tags?: string[];
}

export interface Captured {
  item: string;
  href: string;
  path: string | null;
}

export interface KnowledgeSourceState {
  id: string;
  label: unknown;
  icon: string | null;
  pluginId: string | null;
  items: number;
  lastRunAt: string | null;
  lastSweepAt: string | null;
  lastError: string | null;
}

export interface SemanticStatus {
  enabled: boolean;
  pgvector: boolean;
  model: string | null;
  passages: number;
  embedded: number;
  problem: string | null;
}

const query = (params: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  return search.toString();
};

export const findKnowledge = (
  q: string,
  options: { sources?: string[]; project?: string; limit?: number } = {},
  signal?: AbortSignal,
) =>
  request<KnowledgeFindResult>(
    `/knowledge/find?${query({
      q,
      sources: options.sources?.join(','),
      project: options.project,
      limit: options.limit,
    })}`,
    { signal },
  );

export const listAttachableKnowledge = (
  q: string,
  options: { sources?: string[]; kind?: string; project?: string; limit?: number } = {},
  signal?: AbortSignal,
) =>
  request<KnowledgeFindResult>(
    `/knowledge/picker?${query({
      q,
      sources: options.sources?.join(','),
      kind: options.kind,
      project: options.project,
      limit: options.limit,
    })}`,
    { signal },
  );

export const listMentions = (target: string) =>
  request<KnowledgeMention[]>(`/knowledge/links?${query({ target })}`);

export const captureToKnowledge = (input: CaptureInput) =>
  request<Captured>('/knowledge/capture', { method: 'POST', body: JSON.stringify(input) });

export const captureWebPage = (input: { url: string; html?: string; projectKey?: string }) =>
  request<Captured>('/knowledge/capture/web', { method: 'POST', body: JSON.stringify(input) });

export const openDailyNote = (date?: string) =>
  request<{ path: string; created: boolean }>('/knowledge/journal', {
    method: 'POST',
    body: JSON.stringify(date ? { date } : {}),
  });

export const listNoteTemplates = () =>
  request<{ path: string; name: string }[]>('/knowledge/templates');

export const createNoteFromTemplate = (input: {
  template: string;
  folder: string;
  title: string;
}) =>
  request<{ path: string }>('/knowledge/notes/from-template', {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const listKnowledgeSources = () =>
  request<{ sources: KnowledgeSourceState[]; semantic: SemanticStatus }>('/knowledge/sources');

export const reindexKnowledgeSource = (source: string) =>
  request<void>(`/knowledge/sources/${encodeURIComponent(source)}/reindex`, { method: 'POST' });

export const setSemanticSearch = (enabled: boolean) =>
  request<SemanticStatus>('/knowledge/semantic', {
    method: 'PUT',
    body: JSON.stringify({ enabled }),
  });
