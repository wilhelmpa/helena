import type { ModelRoute } from '@/lib/api/endpoints/decisions';
import type { RunFailure } from '@/lib/api/endpoints/modelAvailability';
import { request } from '@/lib/api/core/client';
import type { ModelCheck, RuntimeProfile } from '@/lib/api/endpoints/agentRuntimeSync';

// One member custom field an agent reacts to, with the seconds its run waits.
export interface AgentFieldTrigger {
  fieldId: number;
  delaySec: number;
}

// The same trigger as a read of an agent returns it: the field's name comes along, so
// a screen can name it without loading the project the field belongs to.
export interface AgentFieldTriggerRead extends AgentFieldTrigger {
  name: string;
}

// A project an agent works in, as its settings list them.
export interface AgentProject {
  id: number;
  key: string;
  name: string;
  roleId: number | null;
  roleName: string | null;
  instructions: string;
}

export interface AgentRuntimeFile {
  kind: 'instructions';
  path: string;
  content: string;
}

export interface AgentRuntimePolicy {
  reasoningEffort: string | null;
  toolAllow: string[];
  // Hermes toolsets the agent may not use in chats and runs.
  toolDeny: string[];
  mcpGrants: string[];
  files: AgentRuntimeFile[];
  // Defaults for the agent's queued runs: Hermes --max-turns (1-200) and --run-budget
  // seconds (60-7200). Chat answers are not limited.
  maxTurns?: number | null;
  runBudgetSeconds?: number | null;
  // Unset, the agent learns and the curator stays off.
  learning?: boolean;
  curator?: boolean;
  // When a learning agent reflects on a run in a short follow-up turn of the same
  // session: 'failure' after a failed run and after rework on an issue, 'complex' also
  // after a run of many tool calls. Unset, 'complex'.
  reflection?: ReflectionMode;
  // Which runtime runs the agent. Unset is Hermes, provisioned by the server; a Claude
  // Code or Codex agent runs on a runner started with that preset.
  runtime?: AgentRuntimeKind;
  // Unset, the agent's own memory writes wait for the owner's approval.
  memoryApproval?: boolean;
  // Skills of the runtime turned off by name.
  skillsDisabled?: string[];
  // The models the runtime falls back to, in order. Unset or null: the instance's list.
  fallbackModels?: FallbackModel[] | null;
  // How Hermes compresses a long conversation; unset fields take the defaults.
  compression?: AgentCompression;
  // Whether a learning agent reflects on its chats once they go quiet (unset: it does),
  // after how many quiet minutes (unset: 10) and after how many of the person's messages
  // at the latest (unset: 20).
  chatReflection?: boolean;
  chatReflectionIdleMinutes?: number;
  chatReflectionEveryTurns?: number;
}

export interface AgentCompression {
  thresholdTokens?: number;
  targetRatio?: number;
  idleCompactMinutes?: number;
  model?: FallbackModel;
}

export interface FallbackModel {
  provider: string;
  model: string;
}

export type ReflectionMode = 'off' | 'failure' | 'complex';
export type AgentRuntimeKind = 'hermes' | 'claude' | 'codex';
export const AGENT_RUNTIME_KINDS: AgentRuntimeKind[] = ['hermes', 'claude', 'codex'];

// One thing the agent's reflection kept: a memory write, or a skill it created or
// patched.
export interface ReflectionSaved {
  tool: 'memory' | 'skill';
  action: string;
  target: string;
}

// The follow-up turn in which the agent kept what a run taught it: 'lost' when its
// runner never reported it. Its tokens are part of the run's own. Null for a run
// without one.
export interface ReflectionView {
  status: 'pending' | 'success' | 'failed' | 'lost';
  reason: 'failure' | 'rework' | 'complex';
  // The local model it ran on when Lokale KI took it; absent: the run's model.
  model?: string | null;
  saved: ReflectionSaved[];
  summary: string | null;
  error: string | null;
  tokens?: number;
}

// A managed file the runtime found changed outside Plan. It wrote Plan's version and kept
// the changed one, whose content is shown so it can be taken over.
export interface AgentRuntimeConflict {
  path: string;
  content: string;
}

// 'bundled' ships with Hermes, 'hub' was installed from the Skills Hub, 'plan' is one of
// Plan's skills, 'agent' was created by the agent.
export type AgentSkillOrigin = 'bundled' | 'hub' | 'plan' | 'agent';

export interface AgentInventorySkill {
  name: string;
  category: string | null;
  description: string;
  origin: AgentSkillOrigin;
  // The skill's directory in the runtime, which an action names it by. Absent from an
  // older runner.
  path?: string;
  pinned?: boolean;
}

export interface AgentInventoryMemory {
  file: 'MEMORY.md' | 'USER.md';
  content: string;
  truncated: boolean;
  // Of the whole file, which an edit names as the version it was made on.
  sha256?: string;
  chars?: number;
}

// What the agent can do in Hermes, as its runner last reported it. Hermes owns all of it;
// only the toolsets can be turned off, through the runtime policy's toolDeny.
export interface AgentRuntimeInventory {
  toolsets: string[];
  mcpServers: string[];
  skills: AgentInventorySkill[];
  memory: AgentInventoryMemory[];
  // Jobs in Hermes' own scheduler, which run outside Plan.
  cronJobs?: number;
}

export interface AgentRuntimeState {
  adapter: string | null;
  status: 'offline' | 'online' | 'degraded';
  appliedRevision: string | null;
  capabilities: string[];
  detail: string | null;
  conflicts: AgentRuntimeConflict[];
  // What the runner put back after it was changed or removed outside Plan.
  restored: string[];
  // Null until a runner that reads it reports one.
  inventory: AgentRuntimeInventory | null;
  // What the runner read back from the runtime's profile, and what differs from Helena.
  profile: RuntimeProfile | null;
  reportedAt: string | null;
}

// An AI agent of a team: a bot user plus its configuration, driven by a runner with
// its API key. `kind` is always 'external', the one kind there is. `apiKeyStart` is the
// non-secret prefix of the key for display, and the plaintext key is only returned
// once, on create and on regenerate.
// The field groups a template copy follows: Skills, Tools, MCP servers, approval rules
// (toolAllow/toolDeny/mcpGrants), instructions (+ runtimePolicy.files), model +
// reasoning standard, and budgets (token ceilings, maxTurns, runBudgetSeconds).
export type TemplateFieldGroup =
  'skills' | 'tools' | 'mcpServers' | 'approvals' | 'instructions' | 'model' | 'budgets';

export interface AiAgent {
  id: number;
  teamId: number;
  // The projects of the team the agent works in. One key reaches every one of them.
  projects: AgentProject[];
  userId: string;
  name: string;
  username: string;
  kind: 'external';
  // The model ref the agent's runtime runs on; null runs the runtime's own default.
  model: string | null;
  instructions: string | null;
  runtimePolicy: AgentRuntimePolicy;
  runtimeState: AgentRuntimeState;
  // Run triggers.
  triggerOnMention: boolean;
  triggerOnAssign: boolean;
  heartbeatIntervalMinutes: number | null;
  heartbeatTimezone: string;
  heartbeatDays: number[];
  heartbeatStart: string;
  heartbeatEnd: string;
  heartbeatInstructions: string;
  heartbeatLastAt: string | null;
  heartbeatNextAt: string | null;
  // The member custom fields that start a run when the agent is set into one, each
  // with the seconds its run waits before the agent may pick it up.
  fieldTriggers: AgentFieldTriggerRead[];
  // How long a delegation run waits before the agent may pick it up.
  delegationDelaySec: number;
  // How many of this agent's chats a member may leave answering at once; a send past
  // the limit is refused until one finishes.
  maxConcurrentChats: number;
  // The member who created the agent, and whose runs an 'owner'-scoped runner is
  // limited to; 'team' scope serves any member's runs.
  ownerUserId: string | null;
  runnerScope: 'owner' | 'team';
  // A template runs nowhere and works in no project; a project adds a copy of it.
  template: boolean;
  // The template this agent was copied from, or null (a template itself, or an agent
  // nobody copied).
  sourceTemplateId: number | null;
  // Field groups this copy's owner changed by hand: a template sync skips them until
  // "reset to template" clears the override.
  templateOverrides: TemplateFieldGroup[];
  // Last time this copy was synced from its template.
  templateSyncedAt: string | null;
  // Null is no ceiling. Days and months are UTC.
  dailyTokenCeiling: number | null;
  monthlyTokenCeiling: number | null;
  // The agent's own Autopilot level (null follows the project) and whether the owner let it
  // exceed the project's.
  autopilotLevel?: number | null;
  autopilotRaise?: boolean;
  // When the agent's runner last polled, or null while none ever has.
  lastSeenAt: string | null;
  // Set while the agent takes no new work, with why.
  pausedAt: string | null;
  pauseReason: string | null;
  createdAt: string;
  apiKeyStart: string | null;
  // How many skills and configured tools are enabled.
  skillCount: number;
  toolCount: number;
}

// A run waits as 'pending' until the agent's runner takes it; 'canceled' is a pending
// run ended by hand.
export type AgentRunStatus = 'pending' | 'success' | 'failed' | 'canceled';

// One row of an agent's autonomous run history. Issue-triggered runs reference an
// issue; scheduled and manual runs do not.
export interface AgentRun {
  id: number;
  status: AgentRunStatus;
  trigger: 'mention' | 'delegation' | 'field' | 'schedule' | 'heartbeat' | 'manual' | 'approval';
  issueId: number | null;
  issueIdentifier: string | null;
  issueTitle: string | null;
  prompt: string;
  attempts: number;
  lastError: string | null;
  output: string | null;
  // What the run read and wrote: its totals where the agent reports them (Hermes),
  // otherwise its last model call. Absent for a run that finished before this was
  // recorded and for one whose agent reports no counts.
  contextTokens?: number;
  // The question the agent asked when it marked its issue blocked during the run.
  blockedQuestion: string | null;
  reflection: ReflectionView | null;
  // The Autopilot level the run worked at; null for a run from before the Autopilot.
  autopilotLevel?: number | null;
  // Null for a run whose runner reports no model.
  modelCheck: ModelCheck | null;
  // What the model router did for the run (docs/helena-decisions/decisions.md §4).
  modelRoute?: ModelRoute | null;
  // Why it failed, where the runtime's words said. Absent from an older server.
  failure?: RunFailure | null;
  nextAttemptAt: string;
  createdAt: string;
}

export interface AgentRunPage {
  items: AgentRun[];
  nextCursor: number | null;
}

export interface NewAiAgentInput {
  name: string;
  username: string;
  model?: string | null;
  instructions?: string | null;
  runtimePolicy?: AgentRuntimePolicy;
  triggerOnMention?: boolean;
  triggerOnAssign?: boolean;
  heartbeatIntervalMinutes?: number | null;
  heartbeatTimezone?: string;
  heartbeatDays?: number[];
  heartbeatStart?: string;
  heartbeatEnd?: string;
  heartbeatInstructions?: string;
  fieldTriggers?: AgentFieldTrigger[];
  delegationDelaySec?: number;
  maxConcurrentChats?: number;
  projectIds?: number[];
  // The project the agent is created in, in place of projectIds: it works there only,
  // as a specialist reporting to the project's coordinator.
  projectId?: number;
  runnerScope?: 'owner' | 'team';
  template?: boolean;
}

export interface AiAgentPatch {
  name?: string;
  username?: string;
  model?: string | null;
  instructions?: string | null;
  runtimePolicy?: AgentRuntimePolicy;
  triggerOnMention?: boolean;
  triggerOnAssign?: boolean;
  heartbeatIntervalMinutes?: number | null;
  heartbeatTimezone?: string;
  heartbeatDays?: number[];
  heartbeatStart?: string;
  heartbeatEnd?: string;
  heartbeatInstructions?: string;
  fieldTriggers?: AgentFieldTrigger[];
  delegationDelaySec?: number;
  maxConcurrentChats?: number;
  projectIds?: number[];
  runnerScope?: 'owner' | 'team';
  template?: boolean;
}

// One event of a streamed agent run (mirrors the API's AgentRunEvent). `text` is a
// chunk of the answer to append; `tool-start`/`tool-end` report a capability the
// agent is using, so the UI can show what it is doing; `done` ends the run with the
// conversation thread id; `error` reports a failure that happened mid-run.
export type AgentRunEvent =
  | { type: 'text'; value: string }
  | { type: 'reasoning'; value: string }
  | { type: 'tool-start'; toolCallId: string; toolName: string; args?: string }
  // The agent's runner sends a call's arguments after the call itself, in pieces.
  | { type: 'tool-args'; toolCallId: string; delta: string }
  | { type: 'tool-end'; toolCallId: string; result?: string }
  | { type: 'done'; threadId: string | null }
  | { type: 'error'; message: string };

// AI agents: a team's bot users and their configuration. Pass projectId to list only
// the agents working in one project of the team. The plaintext key is returned only
// by create and regenerate-key, so those responses carry it alongside the agent; it
// is never part of a list/read.
export const listAiAgents = (teamId: number, projectId?: number) =>
  request<AiAgent[]>(
    `/teams/${teamId}/ai-agents${projectId != null ? `?projectId=${projectId}` : ''}`,
  );

// One agent by id, with its full config — the same shape listAiAgents' items carry.
// 404s when the agent is not of this team or not visible to the caller.
export const getAiAgent = (teamId: number, agentId: number) =>
  request<AiAgent>(`/teams/${teamId}/ai-agents/${agentId}`);

export const createAiAgent = (teamId: number, input: NewAiAgentInput) =>
  request<{ agent: AiAgent; apiKey: string }>(`/teams/${teamId}/ai-agents`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

// Adds a copy of a template to a project as a specialist of its own. The copy's key is
// returned once, like on create.
// `modelFallback` names a template model the provider refused this account: the copy runs on
// its runtime's default instead.
export const copyAiAgentTemplate = (teamId: number, agentId: number, projectId: number) =>
  request<{
    agent: AiAgent;
    apiKey: string;
    modelFallback?: { model: string; detail: string | null };
  }>(`/teams/${teamId}/ai-agents/${agentId}/copy`, {
    method: 'POST',
    body: JSON.stringify({ projectId }),
  });

export const updateAiAgent = (teamId: number, agentId: number, patch: AiAgentPatch) =>
  request<AiAgent>(`/teams/${teamId}/ai-agents/${agentId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });

// Drops a copy's own override of one field group and re-applies the template's
// current value for it right away. A no-op (still 200) when the agent is not a copy or
// has not overridden that group.
export const resetAiAgentToTemplate = (
  teamId: number,
  agentId: number,
  group: TemplateFieldGroup,
) =>
  request<AiAgent | null>(`/teams/${teamId}/ai-agents/${agentId}/reset-to-template`, {
    method: 'POST',
    body: JSON.stringify({ group }),
  });

export const regenerateAiAgentKey = (teamId: number, agentId: number) =>
  request<{ apiKey: string }>(`/teams/${teamId}/ai-agents/${agentId}/regenerate-key`, {
    method: 'POST',
  });

export const deleteAiAgent = (teamId: number, agentId: number) =>
  request<void>(`/teams/${teamId}/ai-agents/${agentId}`, { method: 'DELETE' });

export const listAgentRuns = (teamId: number, agentId: number, before?: number) =>
  request<AgentRunPage>(
    `/teams/${teamId}/ai-agents/${agentId}/runs?limit=25${before ? `&before=${before}` : ''}`,
  );

export interface AgentHeartbeatEvent {
  id: number;
  projectId: number | null;
  checkedAt: string;
  outcome: 'queued' | 'skipped';
  reason: string;
  runId: number | null;
}

export const listAgentHeartbeats = (teamId: number, agentId: number) =>
  request<AgentHeartbeatEvent[]>(`/teams/${teamId}/ai-agents/${agentId}/heartbeats`);
