import { request } from '@/lib/api/core/client';
import type { AgentSkill } from '@/lib/api/endpoints/agentSkills';

export type MemoryFile = 'MEMORY.md' | 'USER.md';

// An owner's decision on what an agent learned, which its runner carries out on its next
// sync. `error` stays null while it waits and says why it failed once it did; a done
// action is not listed.
export interface RuntimeAction {
  id: number;
  // 'rewrite-profile' is "Neu schreiben" (agentRuntimeSync), not a learning decision.
  kind: 'discard-skill' | 'pin-skill' | 'write-memory' | 'rewrite-profile';
  // The skill's path in the runtime, or the memory file.
  target: string;
  pinned: boolean | null;
  error: string | null;
  createdAt: string;
}

export type RuntimeActionInput =
  | { kind: 'discard-skill'; path: string }
  | { kind: 'pin-skill'; path: string; pinned: boolean }
  | { kind: 'write-memory'; file: MemoryFile; content: string; baseSha256: string };

// A skill the agent created, as its runner last reported it. `truncated` is a skill too
// large to report, whose content is left out.
export interface LearnedSkill {
  path: string;
  name: string;
  markdown: string;
  files: { path: string; content: string }[];
  otherFiles: number;
  truncated: boolean;
}

// One version of a skill the agent keeps in its own runtime: who wrote it, when, in which
// session, and the text before and after. `pending` waits for the owner's decision.
export interface SkillChange {
  id: string;
  version: number;
  at: string;
  // 'agent:<id>', 'user:<id>', 'curator' or 'runtime-action:<id>'.
  actor: string;
  sessionId: string | null;
  // 'create', 'update', 'pin', 'unpin', 'archive', 'restore', 'approve', 'reject',
  // 'archive:unused' or 'merge:<path>'.
  action: string;
  status: 'applied' | 'pending' | 'rejected';
  before: Pick<LearnedSkill, 'markdown' | 'files'> | null;
  after: Pick<LearnedSkill, 'markdown' | 'files'>;
}

// A learned skill of the agent's own runtime with its history, for the owner's review.
export interface NativeSkill extends LearnedSkill {
  revision: string;
  version?: number;
  useCount?: number;
  lastUsedAt?: string;
  createdAt?: string;
  // Only proposed so far (new skill waiting for approval).
  proposed?: boolean;
  pinned?: boolean;
  archived?: boolean;
  history?: SkillChange[];
}

export const listNativeSkills = (teamId: number, agentId: number) =>
  request<NativeSkill[]>(`/teams/${teamId}/ai-agents/${agentId}/learned-skills/history`);

export const reviewNativeSkill = (
  teamId: number,
  agentId: number,
  input: { path: string; revision: string; action: 'approve' | 'reject' | 'restore' },
) =>
  request<NativeSkill>(`/teams/${teamId}/ai-agents/${agentId}/learned-skills/review`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const listRuntimeActions = (teamId: number, agentId: number) =>
  request<RuntimeAction[]>(`/teams/${teamId}/ai-agents/${agentId}/runtime-actions`);

export const queueRuntimeAction = (teamId: number, agentId: number, input: RuntimeActionInput) =>
  request<RuntimeAction>(`/teams/${teamId}/ai-agents/${agentId}/runtime-actions`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const getLearnedSkill = (teamId: number, agentId: number, path: string) =>
  request<LearnedSkill>(
    `/teams/${teamId}/ai-agents/${agentId}/learned-skills/content?path=${encodeURIComponent(path)}`,
  );

export const promoteLearnedSkill = (teamId: number, agentId: number, path: string) =>
  request<AgentSkill>(`/teams/${teamId}/ai-agents/${agentId}/learned-skills/promote`, {
    method: 'POST',
    body: JSON.stringify({ path }),
  });

// The agent's latest reflections on its chats (docs/helena-decisions/agent-context.md §5).
export interface ChatReflection {
  id: number;
  threadId: string;
  threadTitle: string | null;
  reason: 'idle' | 'turns';
  status: 'pending' | 'running' | 'success' | 'failed' | 'canceled';
  turns: number;
  saved: { tool: 'memory' | 'skill'; action: string; target: string }[];
  summary: string | null;
  error: string | null;
  tokens: number | null;
  dueAt: string;
  finishedAt: string | null;
}

export const listChatReflections = (teamId: number, agentId: number) =>
  request<ChatReflection[]>(`/teams/${teamId}/ai-agents/${agentId}/chat-reflections`);
