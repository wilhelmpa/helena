import type { ModelRoute } from '@/lib/api/endpoints/decisions';
import type { RunFailure } from '@/lib/api/endpoints/modelAvailability';
import { request } from '@/lib/api/core/client';
import type { AgUiEvent } from '@/lib/api/endpoints/agentChat';
import type { ModelCheck } from '@/lib/api/endpoints/agentRuntimeSync';
import type { AgentRun, FallbackModel, ReflectionView } from '@/lib/api/endpoints/agents';

// What an agent's runtime keeps, read through its runner (sessions, transcripts, logs,
// health, version, curator), a run's timeline, the token ledger, the runtime's proposals
// and the emergency stop. Transcripts follow the OpenTelemetry GenAI message shape.

export interface GenAiUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
}

export interface RuntimeSession {
  id: string;
  title: string | null;
  preview: string | null;
  source: string | null;
  model: string | null;
  startedAt: number | null;
  endedAt: number | null;
  lastActiveAt: number | null;
  endReason: string | null;
  messageCount: number;
  toolCallCount: number;
  usage: GenAiUsage;
  estimatedCostUsd: number | null;
  parentSessionId: string | null;
  // The run or chat of Helena the session belongs to, when known.
  link?: SessionLink | null;
}

export interface SessionLink {
  runId: number | null;
  issueIdentifier: string | null;
  issueTitle: string | null;
  chatThreadId: string | null;
  chatTitle: string | null;
}

export interface SessionSearchHit {
  sessionId: string;
  role: string | null;
  snippet: string;
  session: RuntimeSession | null;
}

export type TranscriptPart =
  | { type: 'text'; content: string }
  | { type: 'reasoning'; content: string }
  | { type: 'tool_call'; id: string | null; name: string; arguments: unknown }
  | {
      type: 'tool_call_response';
      id: string | null;
      name: string | null;
      response: unknown;
      isError?: boolean;
    }
  | { type: 'compaction'; content: string | null };

export interface TranscriptMessage {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  parts: TranscriptPart[];
  timestamp: number | null;
  model?: string | null;
  finishReason?: string | null;
}

export interface Transcript {
  session: RuntimeSession;
  messages: TranscriptMessage[];
  offset: number;
  totalMessages: number;
  truncated: boolean;
}

export interface RuntimeHealth {
  ok: boolean;
  report: string;
  checkedAt: number;
}

export interface RuntimeVersion {
  runtime: string;
  version: string | null;
  detail: string | null;
}

export interface CuratorStatus {
  paused: boolean | null;
  report: string;
}

export interface RuntimeRequestState {
  id: number;
  status: 'pending' | 'claimed' | 'answered' | 'failed';
  result: unknown;
  error: string | null;
}

const agentPath = (teamId: number, agentId: number) => `/teams/${teamId}/ai-agents/${agentId}`;

export const listRuntimeSessions = (
  teamId: number,
  agentId: number,
  opts: { q?: string; limit?: number; offset?: number },
) => {
  const params = new URLSearchParams();
  if (opts.q) params.set('q', opts.q);
  if (opts.limit) params.set('limit', String(opts.limit));
  if (opts.offset) params.set('offset', String(opts.offset));
  return request<{
    page?: { sessions: RuntimeSession[]; total: number };
    hits?: SessionSearchHit[];
  }>(`${agentPath(teamId, agentId)}/runtime/sessions?${params.toString()}`);
};

export const getTranscript = (
  teamId: number,
  agentId: number,
  sessionId: string,
  opts: { offset?: number; limit?: number } = {},
) =>
  request<Transcript>(
    `${agentPath(teamId, agentId)}/runtime/sessions/${encodeURIComponent(sessionId)}?offset=${
      opts.offset ?? 0
    }&limit=${opts.limit ?? 500}`,
  );

export const getRuntimeLogs = (
  teamId: number,
  agentId: number,
  opts: { sessionId?: string | null; lines?: number; level?: string | null },
) => {
  const params = new URLSearchParams({ lines: String(opts.lines ?? 200) });
  if (opts.sessionId) params.set('sessionId', opts.sessionId);
  if (opts.level) params.set('level', opts.level);
  return request<{ lines: string[]; truncated: boolean }>(
    `${agentPath(teamId, agentId)}/runtime/logs?${params.toString()}`,
  );
};

export const getRuntimeHealth = (teamId: number, agentId: number) =>
  request<RuntimeHealth>(`${agentPath(teamId, agentId)}/runtime/health`);

export const getRuntimeVersion = (teamId: number, agentId: number) =>
  request<RuntimeVersion>(`${agentPath(teamId, agentId)}/runtime/version`);

export const getCuratorStatus = (teamId: number, agentId: number) =>
  request<CuratorStatus>(`${agentPath(teamId, agentId)}/runtime/curator`);

export const pinSkill = (teamId: number, agentId: number, skill: string, pinned: boolean) =>
  request<CuratorStatus>(`${agentPath(teamId, agentId)}/runtime/curator`, {
    method: 'POST',
    body: JSON.stringify({ action: pinned ? 'pin' : 'unpin', skill }),
  });

export const runCurator = (teamId: number, agentId: number) =>
  request<{ requestId: number }>(`${agentPath(teamId, agentId)}/runtime/curator/run`, {
    method: 'POST',
  });

export const getRuntimeRequest = (teamId: number, agentId: number, requestId: number) =>
  request<RuntimeRequestState>(`${agentPath(teamId, agentId)}/runtime/requests/${requestId}`);

// ---------------------------------------------------------------- runs

export interface SpendRow {
  kind: string;
  runtime: string | null;
  model: string | null;
  provider: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  durationMs: number | null;
  costEur: number | null;
}

export interface RunDetail {
  id: number;
  agentId: number;
  agentName: string;
  agentUsername: string;
  projectId: number;
  projectKey: string;
  status: 'pending' | 'success' | 'failed' | 'canceled';
  trigger: AgentRun['trigger'];
  issueId: number | null;
  issueIdentifier: string | null;
  issueTitle: string | null;
  prompt: string;
  output: string | null;
  outputs: {
    id: number;
    kind: 'file' | 'preview' | 'pr' | 'screenshot';
    title: string;
    target: string;
    source: 'reported' | 'inferred';
    createdAt: string;
  }[];
  lastError: string | null;
  attempts: number;
  resumes: number;
  sessionId: string | null;
  model: string | null;
  continuedFromRunId: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  usage: SpendRow[];
  // The question a run that ended blocked asked, and the reflection turn after it.
  blockedQuestion: string | null;
  reflection: ReflectionView | null;
  modelCheck: ModelCheck | null;
  // What the model router did for the run (docs/helena-decisions/decisions.md §4).
  modelRoute?: ModelRoute | null;
  // Why it failed, where the runtime's words said. Absent from an older server.
  failure?: RunFailure | null;
}

export interface RunEventPage {
  events: { id: number; claim: number; payload: AgUiEvent; createdAt: string }[];
  next: number;
}

export const getRunDetail = (teamId: number, agentId: number, runId: number) =>
  request<RunDetail>(`${agentPath(teamId, agentId)}/runs/${runId}`);

export const getRunEvents = (teamId: number, agentId: number, runId: number, after = 0) =>
  request<RunEventPage>(`${agentPath(teamId, agentId)}/runs/${runId}/events?after=${after}`);

export const continueRun = (teamId: number, agentId: number, runId: number, instruction: string) =>
  request<{ runId: number }>(`${agentPath(teamId, agentId)}/runs/${runId}/continue`, {
    method: 'POST',
    body: JSON.stringify({ instruction }),
  });

// ---------------------------------------------------------------- usage

export type UsageDimension = 'agent' | 'model' | 'project' | 'day' | 'kind';
// Groupings the report does not show as columns but other views ask for (hub/pc-costs).
export type UsageGrouping = UsageDimension | 'issue' | 'goal' | 'department';

export interface UsageRow {
  // Present when grouped by issue / goal (hub/pc-costs); absent from an older server.
  issueId?: number | null;
  issueTitle?: string | null;
  goalId?: number | null;
  goalTitle?: string | null;
  agentId: number | null;
  agentName: string | null;
  model: string | null;
  provider: string | null;
  projectId: number | null;
  projectKey: string | null;
  day: string | null;
  kind: 'run' | 'chat' | 'reflection' | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  durationMs: number;
  entries: number;
  costEur: number | null;
}

export interface UsageReport {
  from: string;
  to: string;
  by: UsageGrouping[];
  currency: 'EUR';
  unpriced: boolean;
  total: Omit<
    UsageRow,
    | 'issueId'
    | 'issueTitle'
    | 'goalId'
    | 'goalTitle'
    | 'agentId'
    | 'agentName'
    | 'model'
    | 'provider'
    | 'projectId'
    | 'projectKey'
    | 'day'
    | 'kind'
  >;
  rows: UsageRow[];
}

export const getAgentUsage = (
  teamId: number,
  opts: { from?: string; to?: string; agentId?: number; projectId?: number; by: UsageGrouping[] },
) => {
  const params = new URLSearchParams({ by: opts.by.join(',') });
  if (opts.from) params.set('from', opts.from);
  if (opts.to) params.set('to', opts.to);
  if (opts.agentId) params.set('agentId', String(opts.agentId));
  if (opts.projectId) params.set('projectId', String(opts.projectId));
  return request<UsageReport>(`/teams/${teamId}/agent-usage?${params.toString()}`);
};

// ---------------------------------------------------------------- proposals and memory

export type ProposalKind = 'memory-write' | 'hermes-update';
export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'applied' | 'failed';

export interface MemoryProposalPayload {
  file: 'MEMORY.md' | 'USER.md';
  before: string;
  after: string;
}

export interface HermesUpdatePayload {
  target: string;
  from: VersionRef;
  to: VersionRef;
  commits: CommitLine[];
  localPatches: CommitLine[];
}

export interface RuntimeProposal {
  id: number;
  kind: ProposalKind;
  status: ProposalStatus;
  title: string;
  payload: unknown;
  agentId: number | null;
  agentName: string | null;
  agentUsername: string | null;
  teamId: number | null;
  decidedByName: string | null;
  decidedAt: string | null;
  note: string | null;
  error: string | null;
  createdAt: string;
}

export const listProposals = (status: 'pending' | 'decided') =>
  request<RuntimeProposal[]>(`/agent-proposals?status=${status}`);

export const countProposals = () => request<{ count: number }>('/agent-proposals/count');

export const decideProposal = (id: number, approved: boolean, note?: string | null) =>
  request<RuntimeProposal>(`/agent-proposals/${id}/decision`, {
    method: 'POST',
    body: JSON.stringify({ approved, note: note ?? null }),
  });

export interface MemoryRevision {
  id: number;
  file: 'MEMORY.md' | 'USER.md';
  content: string;
  sha256: string;
  source: 'agent' | 'owner' | 'observed';
  proposalId: number | null;
  userName: string | null;
  createdAt: string;
}

export const listMemoryRevisions = (teamId: number, agentId: number, file?: string) =>
  request<MemoryRevision[]>(
    `${agentPath(teamId, agentId)}/memory/revisions${file ? `?file=${encodeURIComponent(file)}` : ''}`,
  );

// ---------------------------------------------------------------- instance

export interface EmergencyStop {
  active: boolean;
  reason: string | null;
  since: string | null;
  byUserId: string | null;
}

export const getEmergencyStop = () => request<EmergencyStop>('/emergency-stop');

export const setEmergencyStop = (active: boolean, reason?: string | null) =>
  request<EmergencyStop>('/god/emergency-stop', {
    method: 'PUT',
    body: JSON.stringify({ active, reason: reason ?? null }),
  });

export interface RuntimeDefaults {
  fallbackModels: FallbackModel[];
  // Days Hermes keeps the sessions of ended runs and chats; null keeps Hermes' own (90).
  sessionRetentionDays: number | null;
  // Which of the skills that ship with Hermes every Hermes profile carries.
  bundledSkills: 'all' | 'essential';
  // From how many tokens Hermes compresses a conversation, for agents without their own.
  compressionThresholdTokens: number;
}

export const getRuntimeDefaults = () => request<RuntimeDefaults>('/god/agent-runtime-settings');

export const setRuntimeDefaults = (patch: Partial<RuntimeDefaults>) =>
  request<RuntimeDefaults>('/god/agent-runtime-settings', {
    method: 'PUT',
    body: JSON.stringify(patch),
  });

export interface VersionRef {
  commit: string;
  describe: string | null;
  version: string | null;
}

export interface CommitLine {
  commit: string;
  date: string;
  subject: string;
}

export interface HermesUpdateState {
  checkedAt: string | null;
  check: {
    current: VersionRef;
    latest: VersionRef;
    commits: CommitLine[];
    localPatches: CommitLine[];
  } | null;
  proposal: {
    id: number;
    status: ProposalStatus;
    title: string;
    error: string | null;
    decidedAt: string | null;
    createdAt: string;
    log: string | null;
  } | null;
}

export const getHermesUpdate = () => request<HermesUpdateState>('/god/hermes-update');

export const checkHermesUpdate = () =>
  request<HermesUpdateState>('/god/hermes-update/check', { method: 'POST' });

export const requestHermesUpdate = () =>
  request<{ proposalId: number }>('/god/hermes-update/request', { method: 'POST' });
