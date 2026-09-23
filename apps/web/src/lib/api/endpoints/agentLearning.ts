import { request } from '@/lib/api/core/client';
import type { AgentSkill } from '@/lib/api/endpoints/agentSkills';

export type MemoryFile = 'MEMORY.md' | 'USER.md';

// An owner's decision on what an agent learned, which its runner carries out on its next
// sync. `error` stays null while it waits and says why it failed once it did; a done
// action is not listed.
export interface RuntimeAction {
  id: number;
  kind: 'discard-skill' | 'pin-skill' | 'write-memory';
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
