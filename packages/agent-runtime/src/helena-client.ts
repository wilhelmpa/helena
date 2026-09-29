import type { ModelMessage } from 'ai';
import type { PolicyQuestion } from './tools/types';

// Helena's API as the loop reaches it, with the agent's own key (the runner hands it in
// ITSAPLAN_API_KEY; an isolated agent reaches the API through its unit's plan.sock
// forwarder, whose address is ITSAPLAN_URL). Every route the loop calls answers for this
// agent only (runner auth: `runnerAgent`).

export interface Decision {
  allowed: boolean;
  message: string;
}

export interface StoredSession {
  id: string;
  summary: string | null;
  compactedThrough: number;
  items: { seq: number; step: number; message: ModelMessage }[];
}

export interface MemoryState {
  files: { file: string; content: string; sha256: string }[];
  notes: { day: string; content: string }[];
  approval: boolean;
}

export interface SessionHit {
  ref: string;
  title: string;
  snippet: string;
  href: string;
  updatedAt: string;
}

export interface LearnedRuntimeSkill {
  path: string;
  name: string;
  markdown: string;
  files: { path: string; content: string }[];
  otherFiles: number;
  truncated: boolean;
  revision?: string;
  status?: string;
  change?: unknown;
}

export interface FollowupBatch {
  pending: boolean;
  replace: boolean;
  items: { seq: number; step: number; message: ModelMessage }[];
}

export interface HelenaApi {
  followups?(boundary?: {
    sessionId: string;
    afterSeq: number;
    step: number;
  }): Promise<FollowupBatch>;
  selectTools?(input: {
    prompt: string;
    tools: { name: string; description: string }[];
    projectKey?: string;
  }): Promise<{ names: string[] | null }>;
  decide(question: PolicyQuestion & { runtime: 'helena'; workspace?: string }): Promise<Decision>;
  createSession(input: {
    kind: 'run' | 'chat' | 'reflection';
    model: string;
    runId: number | null;
    threadId: string | null;
  }): Promise<string>;
  loadSession(id: string): Promise<StoredSession | null>;
  appendItems(
    id: string,
    items: { seq: number; step: number; message: ModelMessage; text: string }[],
  ): Promise<void>;
  compact(id: string, summary: string, compactedThrough: number): Promise<void>;
  memory(): Promise<MemoryState>;
  note(text: string): Promise<void>;
  proposeMemory(file: string, content: string, reason: string): Promise<{ status: string }>;
  learnedSkills?(includeArchived?: boolean): Promise<LearnedRuntimeSkill[]>;
  saveSkill?(
    skill: LearnedRuntimeSkill,
    baseRevision: string | null,
    options?: { sessionId?: string; structured?: boolean },
  ): Promise<LearnedRuntimeSkill>;
  skillUsed?(name: string): Promise<void>;
  searchSessions(query: string, limit?: number): Promise<SessionHit[]>;
}

export class HelenaRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class HelenaClient implements HelenaApi {
  selectTools(input: {
    prompt: string;
    tools: { name: string; description: string }[];
    projectKey?: string;
  }): Promise<{ names: string[] | null }> {
    return this.request(
      'POST',
      '/decisions/tool-selection',
      { ...input, ...(this.ids.messageId ? { chatMessageId: this.ids.messageId } : {}) },
      1500,
    );
  }
  private readonly base: string;

  constructor(
    url: string,
    private readonly apiKey: string,
    private readonly ids: { runId: number | null; messageId: number | null; claim?: number } = {
      runId: null,
      messageId: null,
    },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.base = url.replace(/\/+$/, '');
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    timeoutMs = 20_000,
  ): Promise<T> {
    const response = await this.fetchImpl(`${this.base}${path}`, {
      method,
      headers: {
        'x-api-key': this.apiKey,
        ...(body !== undefined && { 'content-type': 'application/json' }),
        ...(this.ids.runId !== null && { 'x-helena-run': String(this.ids.runId) }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error',
    });
    if (!response.ok) {
      let message = `Helena answered ${response.status}`;
      try {
        const payload = (await response.json()) as { message?: string; error?: string };
        message = payload.message ?? payload.error ?? message;
      } catch {
        // no JSON body
      }
      throw new HelenaRequestError(response.status, message);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  followups(boundary?: {
    sessionId: string;
    afterSeq: number;
    step: number;
  }): Promise<FollowupBatch> {
    if (!this.ids.claim || (!this.ids.messageId && !this.ids.runId))
      return Promise.resolve({ pending: false, replace: false, items: [] });
    return this.request('POST', '/agent-runtime/followups', {
      kind: this.ids.messageId ? 'chat' : 'run',
      id: this.ids.messageId ?? this.ids.runId,
      claim: this.ids.claim,
      ...boundary,
    });
  }

  learnedSkills(includeArchived = false): Promise<LearnedRuntimeSkill[]> {
    return this.request(
      'GET',
      `/agent-runtime/skills${includeArchived ? '?includeArchived=true' : ''}`,
    );
  }

  saveSkill(
    skill: LearnedRuntimeSkill,
    baseRevision: string | null,
    options?: { sessionId?: string; structured?: boolean },
  ): Promise<LearnedRuntimeSkill> {
    return this.request('PUT', '/agent-runtime/skills', { skill, baseRevision, ...options });
  }

  async skillUsed(name: string): Promise<void> {
    await this.request('POST', '/agent-runtime/skills/use', { name });
  }

  // Denied whenever Helena cannot be asked: a policy that cannot be checked does not hold.
  async decide(
    question: PolicyQuestion & { runtime: 'helena'; workspace?: string },
  ): Promise<Decision> {
    try {
      const answer = await this.request<{ outcome?: string; message?: string }>(
        'POST',
        '/agent-policy/decide',
        {
          ...question,
          ...(this.ids.runId !== null
            ? { runId: this.ids.runId }
            : this.ids.messageId !== null
              ? { messageId: this.ids.messageId }
              : {}),
        },
        15_000,
      );
      return answer.outcome === 'allow'
        ? { allowed: true, message: '' }
        : { allowed: false, message: answer.message || "BLOCKED by Helena's Autopilot." };
    } catch (error) {
      return {
        allowed: false,
        message:
          `BLOCKED: Helena could not decide on this call (${error instanceof Error ? error.message : 'unknown error'}). ` +
          'Do not run it or reach the same result another way; end the turn and report the problem.',
      };
    }
  }

  async createSession(input: {
    kind: 'run' | 'chat' | 'reflection';
    model: string;
    runId: number | null;
    threadId: string | null;
  }): Promise<string> {
    const answer = await this.request<{ id: string }>('POST', '/agent-runtime/sessions', input);
    return answer.id;
  }

  async loadSession(id: string): Promise<StoredSession | null> {
    try {
      return await this.request<StoredSession>(
        'GET',
        `/agent-runtime/sessions/${encodeURIComponent(id)}`,
      );
    } catch (error) {
      if (error instanceof HelenaRequestError && error.status === 404) return null;
      throw error;
    }
  }

  async appendItems(
    id: string,
    items: { seq: number; step: number; message: ModelMessage; text: string }[],
  ): Promise<void> {
    if (items.length === 0) return;
    await this.request('POST', `/agent-runtime/sessions/${encodeURIComponent(id)}/items`, {
      items,
    });
  }

  async compact(id: string, summary: string, compactedThrough: number): Promise<void> {
    await this.request('POST', `/agent-runtime/sessions/${encodeURIComponent(id)}/compaction`, {
      summary,
      compactedThrough,
    });
  }

  memory(): Promise<MemoryState> {
    return this.request<MemoryState>('GET', '/agent-runtime/memory');
  }

  async note(text: string): Promise<void> {
    await this.request('POST', '/agent-runtime/memory/notes', { text });
  }

  proposeMemory(file: string, content: string, reason: string): Promise<{ status: string }> {
    return this.request('POST', '/agent-runtime/memory/proposals', { file, content, reason });
  }

  async searchSessions(query: string, limit = 8): Promise<SessionHit[]> {
    const params = new URLSearchParams({
      q: query,
      sources: 'agent-session,chat,run',
      limit: String(limit),
    });
    const answer = await this.request<{ items: SessionHit[] }>('GET', `/knowledge/find?${params}`);
    return answer.items ?? [];
  }
}
