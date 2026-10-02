import {
  db,
  aiAgent,
  user,
  apikey,
  project,
  projectColumn,
  projectMember,
  organizationAgentAssignment,
  projectProvisioningJob,
  teamMember,
  teamRole,
  agentSkillLink,
  agentToolLink,
  agentMcpServerLink,
  agentFieldTrigger,
  customField,
  helenaBudget,
  getDisplayName,
} from '@repo/db';
import { and, asc, eq, inArray, isNull, ne, notInArray, or, sql } from 'drizzle-orm';
import { normalizeContextLimits, normalizeRuntimeAccount, type RuntimeAccount } from '@helena/sdk';
import { API_KEY_MAX_NAME_LENGTH, auth } from '@repo/auth';
import { iso, HttpError, rethrowDuplicate } from '#shared/lib';
import { listAgentMemberFieldIds } from '#modules/custom-fields/service';
import { runsTeam, type TeamStanding } from '#modules/teams/service';
import { getDefaultRoleId } from '#modules/roles/service';
import { deleteAccount } from '#shared/account-deletion';
import { normalizeRuntimeInventory } from './inventory';
import { runtimeFileKind } from '../runtime-files/paths';
import { maxTurnsLimit, runBudgetSecondsLimit } from '../model';
import { notHomeAgent } from './home-agent';
import { nextHeartbeatAt, validateHeartbeatClock, type HeartbeatClock } from './heartbeat-time';
import { copyAgentBudgets, copyAgentLevel } from '#modules/autopilot/copy';
import { agentModelRefusal } from '#modules/model-availability/service';
import { inferModelRole } from '#modules/model-schemas/roles';
import { initialAgentModel, syncAgentModel } from '#modules/model-schemas/service';
import {
  onTemplateRelevantChange,
  runtimePolicyGroupsChanged,
  type TemplateFieldGroup,
} from './template-sync';
import type { profileReport, runtimeIssue, runtimeSandbox } from '../runtime-sync/model';

// Data access for AI agents. Each agent is backed by a hidden bot user
// (ai_agent.user_id -> user.id): that user is what a work item is assigned to,
// what authors comments/activity, and what owns the agent's better-auth API key
// (apikey.reference_id).
//
// An agent belongs to a team and works in the projects of that team it is attached
// to; a project_member row is what says so, and one key therefore reaches every one
// of them. An agent acts through the same API under the same authorization as a
// person: it owns an API key and project_member rows carrying its team role, so its
// requests are checked by the normal permission matrix. It is driven over HTTP by its
// runner, which holds the key; Helena itself never runs a model. better-auth stores
// only a hash of the key, so the secret is returned once, on create and on rotation.

// The one kind of agent there is. The column and the field stay so the rows and the
// clients that name it keep reading the same shape.
export type AgentKind = 'external';

// Which runs an external agent's runner is served. 'project', the default: any
// member's runs, so an agent added to a project works for the whole team. 'owner':
// only runs triggered by the member who created it, for a runner whose machine and
// credentials should serve nobody else.
export type RunnerScope = 'owner' | 'team';

export interface AgentRuntimePolicy {
  reasoningEffort: string | null;
  toolAllow: string[];
  toolDeny: string[];
  mcpGrants: string[];
  files: { kind: 'instructions'; path: string; content: string }[];
  // Null clears a limit. A normalized policy carries a limit only when it is set, so
  // the policy of an agent without limits keeps its shape and its revision. The same
  // holds for the two learning switches.
  maxTurns?: number | null;
  runBudgetSeconds?: number | null;
  learning?: boolean;
  curator?: boolean;
  reflection?: ReflectionMode;
  // Unset: memory writes take effect without approval.
  memoryApproval?: boolean;
  contextLimits?: import('@helena/sdk').ContextLimits;
  skillsDisabled?: string[];
  // Unset or null: the instance's default list. Empty: no fallback.
  fallbackModels?: { provider: string; model: string }[] | null;
  // Which runtime runs the agent. Unset is Hermes, which the server provisions itself; a
  // Other agents run on the runner selected in their project descriptor.
  runtime?: AgentRuntimeKind;
  escalation?: AgentEscalationPolicy;
  // Settings of Helena's own loop (runtime `helena`).
  helena?: AgentHelenaSettings;
  commandScript?: string;
  webhookUrl?: string;
  webhookSecretEnv?: string;
  // How Hermes compresses a long conversation (docs/helena-decisions/agent-context.md §6).
  // A field left out takes the instance's default (the threshold) or Hermes' own.
  compression?: AgentCompression;
  // Whether a learning agent reflects on its chats (§5): a follow-up turn in the chat's
  // session once the chat went quiet for `chatReflectionIdleMinutes`, or after
  // `chatReflectionEveryTurns` of the person's messages. Unset: on, 10 and 20.
  chatReflection?: boolean;
  chatReflectionIdleMinutes?: number;
  chatReflectionEveryTurns?: number;
}

export interface AgentEscalationPolicy {
  target?: 'claude' | 'codex';
  model: string | null;
  afterFailures: number;
  onResumeLimit: boolean;
  onRequest: boolean;
  maxDepth: number;
}

export const DEFAULT_AGENT_ESCALATION: AgentEscalationPolicy = {
  target: 'codex',
  model: 'gpt-6.1-sol',
  afterFailures: 0,
  onResumeLimit: false,
  onRequest: true,
  maxDepth: 1,
};

export function normalizeAgentEscalation(value: unknown): AgentEscalationPolicy {
  const raw = value && typeof value === 'object' ? (value as Partial<AgentEscalationPolicy>) : {};
  const integer = (candidate: unknown, fallback: number, maximum: number) =>
    typeof candidate === 'number' &&
    Number.isInteger(candidate) &&
    candidate >= 0 &&
    candidate <= maximum
      ? candidate
      : fallback;
  return {
    ...((raw.target === 'claude' || raw.target === 'codex') && { target: raw.target }),
    model:
      typeof raw.model === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:+@/-]{0,199}$/.test(raw.model)
        ? raw.model
        : null,
    afterFailures: integer(raw.afterFailures, DEFAULT_AGENT_ESCALATION.afterFailures, 5),
    onResumeLimit:
      typeof raw.onResumeLimit === 'boolean'
        ? raw.onResumeLimit
        : DEFAULT_AGENT_ESCALATION.onResumeLimit,
    onRequest:
      typeof raw.onRequest === 'boolean' ? raw.onRequest : DEFAULT_AGENT_ESCALATION.onRequest,
    maxDepth: integer(raw.maxDepth, DEFAULT_AGENT_ESCALATION.maxDepth, 1),
  };
}

export interface AgentCompression {
  // Hermes compresses once a call's context reaches this many tokens
  // (compression.threshold_tokens), whatever the model's window allows.
  thresholdTokens?: number;
  // What the compressed context keeps, as a share of the threshold (compression.target_ratio).
  targetRatio?: number;
  // A session resumed after this many idle minutes is compressed before it answers
  // (compression.idle_compact_after_seconds); unset or 0 never.
  idleCompactMinutes?: number;
  // The model that writes the summaries (auxiliary.compression); unset: Hermes' choice, the
  // agent's own model or the local model Lokale KI names.
  model?: { provider: string; model: string };
}

export const COMPRESSION_LIMITS = {
  thresholdTokens: { min: 16_000, max: 1_000_000 },
  targetRatio: { min: 0.1, max: 0.5 },
  idleCompactMinutes: { min: 0, max: 7 * 24 * 60 },
} as const;
export const CHAT_REFLECTION_LIMITS = {
  idleMinutes: { min: 2, max: 24 * 60, default: 10 },
  everyTurns: { min: 2, max: 200, default: 20 },
} as const;

export type ReflectionMode = 'off' | 'failure' | 'complex';
const REFLECTION_MODES: ReflectionMode[] = ['off', 'failure', 'complex'];
export type AgentRuntimeKind = 'hermes' | 'claude' | 'codex' | 'command' | 'webhook' | 'helena';

// Helena's own agent loop (docs/helena-decisions/zentrale-laufzeit.md) is behind a switch
// while it replaces Hermes step by step: without HELENA_NATIVE_RUNTIME=on the API does not
// know it, so an agent set to it runs on Hermes again (the way back).
export function nativeRuntimeEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.HELENA_NATIVE_RUNTIME?.trim().toLowerCase() === 'on';
}

const BASE_RUNTIMES: AgentRuntimeKind[] = ['hermes', 'claude', 'codex', 'command', 'webhook'];

export function agentRuntimes(): AgentRuntimeKind[] {
  return nativeRuntimeEnabled() ? [...BASE_RUNTIMES, 'helena'] : BASE_RUNTIMES;
}

// The runtimes every instance knows; agentRuntimes() adds Helena's own while it is switched on.
export const AGENT_RUNTIMES: AgentRuntimeKind[] = BASE_RUNTIMES;

export interface AgentHelenaSettings {
  chatBudgetSeconds?: number;
  chatBudgetBehavior?: 'summarize' | 'fail';
  chatSummarySeconds?: number;

  toolProfile?: 'assistent' | 'recherche' | 'coder-lite' | 'voll';
  escalation?: {
    mode?: 'auto' | 'never' | 'always';
    target?: string | null;
    taskKinds?: string[];
    confidenceBelow?: number;
    onFailure?: boolean;
  };
  browserBudgetSeconds?: number;
  localModelQueueSeconds?: number;
}

const TOOL_PROFILES = ['assistent', 'recherche', 'coder-lite', 'voll'] as const;
const ESCALATION_TARGET =
  /^(agent:[1-9]\d*|runtime:(claude|codex)(\/[A-Za-z0-9._:-]{1,80})?|[a-z0-9][a-z0-9-]{0,40}\/[A-Za-z0-9._:/-]{1,120})$/;

// The settings of Helena's own loop as stored: only known fields, in their bounds.
export function helenaSettings(value: unknown): AgentHelenaSettings | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const out: AgentHelenaSettings = {};
  for (const [key, min, max] of [
    ['chatBudgetSeconds', 60, 7200],
    ['chatSummarySeconds', 5, 180],
  ] as const) {
    const value = raw[key];
    if (typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max)
      out[key] = value;
  }
  if (raw.chatBudgetBehavior === 'summarize' || raw.chatBudgetBehavior === 'fail')
    out.chatBudgetBehavior = raw.chatBudgetBehavior;

  if (TOOL_PROFILES.includes(raw.toolProfile as never)) {
    out.toolProfile = raw.toolProfile as AgentHelenaSettings['toolProfile'];
  }
  if (typeof raw.browserBudgetSeconds === 'number' && raw.browserBudgetSeconds >= 30) {
    out.browserBudgetSeconds = Math.min(Math.round(raw.browserBudgetSeconds), 3600);
  }
  if (
    typeof raw.localModelQueueSeconds === 'number' &&
    Number.isInteger(raw.localModelQueueSeconds) &&
    raw.localModelQueueSeconds >= 0 &&
    raw.localModelQueueSeconds <= 86_400
  ) {
    out.localModelQueueSeconds = raw.localModelQueueSeconds;
  }
  const escalation = raw.escalation as Record<string, unknown> | undefined;
  if (escalation && typeof escalation === 'object') {
    const next: NonNullable<AgentHelenaSettings['escalation']> = {};
    if (['auto', 'never', 'always'].includes(escalation.mode as string)) {
      next.mode = escalation.mode as 'auto' | 'never' | 'always';
    }
    if (escalation.target === null) next.target = null;
    else if (
      typeof escalation.target === 'string' &&
      ESCALATION_TARGET.test(escalation.target.trim())
    ) {
      next.target = escalation.target.trim();
    }
    if (Array.isArray(escalation.taskKinds)) {
      next.taskKinds = escalation.taskKinds
        .filter((kind): kind is string => typeof kind === 'string' && !!kind.trim())
        .map((kind) => kind.trim().toLowerCase().slice(0, 40))
        .slice(0, 20);
    }
    if (typeof escalation.confidenceBelow === 'number') {
      next.confidenceBelow = Math.max(0, Math.min(1, escalation.confidenceBelow));
    }
    if (typeof escalation.onFailure === 'boolean') next.onFailure = escalation.onFailure;
    if (Object.keys(next).length > 0) out.escalation = next;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export interface AgentRuntimeConflict {
  path: string;
  content: string;
}

export interface AgentRuntimeInventory {
  toolsets: string[];
  mcpServers: string[];
  skills: {
    name: string;
    category: string | null;
    description: string;
    origin: 'bundled' | 'hub' | 'plan' | 'agent';
    path?: string;
    pinned?: boolean;
  }[];
  memory: {
    file: 'MEMORY.md' | 'USER.md';
    content: string;
    truncated: boolean;
    sha256?: string;
    chars?: number;
  }[];
  cronJobs?: number;
}

export interface AgentRuntimeState {
  adapter: string | null;
  status: 'offline' | 'online' | 'degraded';
  appliedRevision: string | null;
  capabilities: string[];
  detail: string | null;
  conflicts: AgentRuntimeConflict[];
  restored: string[];
  // Null until a runner that reads it reports one.
  inventory: AgentRuntimeInventory | null;
  // What the runner read back from the runtime's profile: its digest, the drift it found
  // and could not put right, and the runtime's own defaults. Null until one reports it.
  profile: AgentRuntimeProfile | null;
  // The version of the runtime's program ("2.1.281"), where the runner reads one.
  version: string | null;
  // What keeps the runtime from its work, or part of it ("Laufzeit nicht angemeldet").
  issues: AgentRuntimeIssue[];
  // Where the runtime runs the model's commands, for one with a sandbox of its own (Codex).
  sandbox: AgentRuntimeSandbox | null;
  // The runtime's own login in the agent's home (Claude Code, Codex), as the runtime told
  // the runner: the account's facts, never the login.
  account: RuntimeAccount | null;
  reportedAt: string | null;
}

export type AgentRuntimeProfile = typeof profileReport.static;
export type AgentRuntimeIssue = typeof runtimeIssue.static;
export type AgentRuntimeSandbox = typeof runtimeSandbox.static;

const EMPTY_RUNTIME_POLICY: AgentRuntimePolicy = {
  reasoningEffort: null,
  toolAllow: [],
  toolDeny: [],
  mcpGrants: [],
  files: [],
  memoryApproval: false,
};

// The value when it is a whole number inside the limit, otherwise null.
export function runLimit(
  value: unknown,
  limit: { minimum: number; maximum: number },
): number | null {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= limit.minimum &&
    value <= limit.maximum
    ? value
    : null;
}

const EMPTY_RUNTIME_STATE: AgentRuntimeState = {
  adapter: null,
  status: 'offline',
  appliedRevision: null,
  capabilities: [],
  detail: null,
  conflicts: [],
  restored: [],
  inventory: null,
  profile: null,
  version: null,
  issues: [],
  sandbox: null,
  account: null,
  reportedAt: null,
};

function normalizeRuntimeState(value: unknown): AgentRuntimeState {
  if (!value || typeof value !== 'object') return { ...EMPTY_RUNTIME_STATE };
  const state = value as Partial<AgentRuntimeState>;
  return {
    adapter:
      typeof state.adapter === 'string' && state.adapter.trim() ? state.adapter.trim() : null,
    status: state.status === 'online' || state.status === 'degraded' ? state.status : 'offline',
    appliedRevision:
      typeof state.appliedRevision === 'string' && state.appliedRevision.trim()
        ? state.appliedRevision.trim()
        : null,
    capabilities: Array.isArray(state.capabilities)
      ? [...new Set(state.capabilities.filter((v): v is string => typeof v === 'string'))]
      : [],
    detail:
      typeof state.detail === 'string' && state.detail.trim() ? state.detail.slice(0, 500) : null,
    conflicts: Array.isArray(state.conflicts)
      ? state.conflicts.filter(
          (conflict): conflict is AgentRuntimeConflict =>
            !!conflict &&
            typeof conflict === 'object' &&
            typeof conflict.path === 'string' &&
            typeof conflict.content === 'string',
        )
      : [],
    restored: Array.isArray(state.restored)
      ? state.restored.filter((path): path is string => typeof path === 'string')
      : [],
    inventory: normalizeRuntimeInventory(state.inventory),
    profile:
      state.profile && typeof state.profile === 'object' && Array.isArray(state.profile.drift)
        ? state.profile
        : null,
    version: typeof state.version === 'string' && state.version ? state.version.slice(0, 64) : null,
    // Validated when the runner reported them.
    issues: Array.isArray(state.issues) ? state.issues : [],
    sandbox:
      state.sandbox === 'workspace-write' ||
      state.sandbox === 'read-only' ||
      state.sandbox === 'danger-full-access'
        ? state.sandbox
        : null,
    // Checked again field by field, whatever was stored.
    account: normalizeRuntimeAccount(state.account),
    reportedAt: typeof state.reportedAt === 'string' ? state.reportedAt : null,
  };
}

export function normalizeRuntimePolicy(value: unknown): AgentRuntimePolicy {
  if (!value || typeof value !== 'object') return { ...EMPTY_RUNTIME_POLICY };
  const policy = value as Partial<AgentRuntimePolicy>;
  const strings = (items: unknown) =>
    Array.isArray(items)
      ? [
          ...new Set(
            items
              .filter((item): item is string => typeof item === 'string')
              .map((s) => s.trim())
              .filter(Boolean),
          ),
        ]
      : [];
  const files = Array.isArray(policy.files)
    ? policy.files.filter(
        (file): file is AgentRuntimePolicy['files'][number] =>
          !!file &&
          typeof file === 'object' &&
          file.kind === 'instructions' &&
          typeof file.path === 'string' &&
          runtimeFileKind(file.path) === file.kind &&
          typeof file.content === 'string',
      )
    : [];
  const maxTurns = runLimit(policy.maxTurns, maxTurnsLimit);
  const runBudgetSeconds = runLimit(policy.runBudgetSeconds, runBudgetSecondsLimit);
  const commandScript = typeof policy.commandScript === 'string' ? policy.commandScript.trim() : '';
  const webhookUrl = typeof policy.webhookUrl === 'string' ? policy.webhookUrl.trim() : '';
  const webhookSecretEnv =
    typeof policy.webhookSecretEnv === 'string' ? policy.webhookSecretEnv.trim() : '';
  return {
    reasoningEffort:
      typeof policy.reasoningEffort === 'string' && policy.reasoningEffort.trim()
        ? policy.reasoningEffort.trim()
        : null,
    toolAllow: strings(policy.toolAllow),
    toolDeny: strings(policy.toolDeny),
    mcpGrants: strings(policy.mcpGrants),
    files,
    ...(maxTurns === null ? {} : { maxTurns }),
    ...(runBudgetSeconds === null ? {} : { runBudgetSeconds }),
    ...(typeof policy.learning === 'boolean' && { learning: policy.learning }),
    ...(typeof policy.curator === 'boolean' && { curator: policy.curator }),
    ...(REFLECTION_MODES.includes(policy.reflection as ReflectionMode) && {
      reflection: policy.reflection,
    }),
    memoryApproval: policy.memoryApproval === true,
    ...(policy.contextLimits && { contextLimits: normalizeContextLimits(policy.contextLimits) }),
    ...(Array.isArray(policy.skillsDisabled) && { skillsDisabled: strings(policy.skillsDisabled) }),
    ...(Array.isArray(policy.fallbackModels) && {
      fallbackModels: policy.fallbackModels
        .filter(
          (entry): entry is { provider: string; model: string } =>
            !!entry &&
            typeof entry.provider === 'string' &&
            typeof entry.model === 'string' &&
            !!entry.provider.trim() &&
            !!entry.model.trim(),
        )
        .map((entry) => ({ provider: entry.provider.trim(), model: entry.model.trim() }))
        .slice(0, 8),
    }),
    // Hermes is the default and is left out, so an agent's policy keeps its revision.
    ...(agentRuntimes().includes(policy.runtime as AgentRuntimeKind) &&
      policy.runtime !== 'hermes' && { runtime: policy.runtime }),
    ...(policy.escalation && { escalation: normalizeAgentEscalation(policy.escalation) }),
    ...(helenaSettings(policy.helena) && { helena: helenaSettings(policy.helena) }),
    ...(commandScript &&
      commandScript.length <= 256 &&
      !commandScript.startsWith('/') &&
      commandScript.split('/').every((part) => part !== '.' && part !== '..' && part !== '') &&
      /^[A-Za-z0-9_./-]+$/.test(commandScript) && { commandScript }),
    ...(webhookUrl &&
      webhookUrl.length <= 2048 &&
      (() => {
        try {
          const url = new URL(webhookUrl);
          return url.protocol === 'https:' && !url.username && !url.password && !url.hash;
        } catch {
          return false;
        }
      })() && { webhookUrl }),
    ...(webhookSecretEnv &&
      /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(webhookSecretEnv) && { webhookSecretEnv }),
    ...compressionField(policy.compression),
    ...(typeof policy.chatReflection === 'boolean' && { chatReflection: policy.chatReflection }),
    ...boundedInteger(
      'chatReflectionIdleMinutes',
      policy.chatReflectionIdleMinutes,
      CHAT_REFLECTION_LIMITS.idleMinutes,
    ),
    ...boundedInteger(
      'chatReflectionEveryTurns',
      policy.chatReflectionEveryTurns,
      CHAT_REFLECTION_LIMITS.everyTurns,
    ),
  };
}

// A whole number within its bounds as `{ [key]: value }`, else nothing: a value out of
// bounds is dropped rather than clamped, like the run limits.
function boundedInteger<K extends string>(
  key: K,
  value: unknown,
  limits: { min: number; max: number },
): Partial<Record<K, number>> {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= limits.min &&
    value <= limits.max
    ? ({ [key]: value } as Record<K, number>)
    : {};
}

// The compression settings that are set and valid; nothing at all when none is, so an agent
// without them keeps its revision.
function compressionField(value: unknown): { compression?: AgentCompression } {
  if (!value || typeof value !== 'object') return {};
  const input = value as Record<string, unknown>;
  const ratio = input.targetRatio;
  const model = input.model as { provider?: unknown; model?: unknown } | null | undefined;
  const compression: AgentCompression = {
    ...boundedInteger('thresholdTokens', input.thresholdTokens, COMPRESSION_LIMITS.thresholdTokens),
    ...(typeof ratio === 'number' &&
      ratio >= COMPRESSION_LIMITS.targetRatio.min &&
      ratio <= COMPRESSION_LIMITS.targetRatio.max && {
        targetRatio: Math.round(ratio * 100) / 100,
      }),
    ...boundedInteger(
      'idleCompactMinutes',
      input.idleCompactMinutes,
      COMPRESSION_LIMITS.idleCompactMinutes,
    ),
    ...(model &&
      typeof model.provider === 'string' &&
      typeof model.model === 'string' &&
      model.provider.trim() &&
      model.model.trim() && {
        model: { provider: model.provider.trim(), model: model.model.trim() },
      }),
  };
  return Object.keys(compression).length > 0 ? { compression } : {};
}

// One member custom field an agent reacts to, with the seconds its run waits before
// the agent may pick it up.
export interface FieldTrigger {
  fieldId: number;
  delaySec: number;
}

// The same trigger as a read of an agent returns it: the field's name comes along, so
// a reader can name the field without loading the project it belongs to.
export interface FieldTriggerRead extends FieldTrigger {
  name: string;
}

// A project the agent is a member of, as the settings screen lists them.
export interface AgentProject {
  id: number;
  key: string;
  name: string;
  roleId: number | null;
  roleName: string | null;
  instructions: string;
}

export interface AiAgentRow {
  id: number;
  teamId: number;
  userId: string;
  // The projects of the team the agent works in, by key. Membership is what grants
  // its key access to a project, so this is the list an operator edits.
  projects: AgentProject[];
  // name lives on the bot user; username is the team-scoped handle.
  name: string;
  username: string;
  kind: AgentKind;
  agentRole: 'agent' | 'home';
  projectScope: 'selected' | 'all';
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
  // The member custom fields the agent also reacts to: being set into one of them
  // starts a run the way being made an issue's delegate does. Each field carries its
  // own delay, so a field can start at once while another leaves time to edit.
  fieldTriggers: FieldTriggerRead[];
  // How long a delegation run waits before it can be claimed.
  delegationDelaySec: number;
  // How many of the agent's chats a member may leave answering at once.
  maxConcurrentChats: number;
  // The member who created the agent, and whose runs an 'owner'-scoped runner is
  // limited to. 'team' scope lets the runner take any member's runs.
  ownerUserId: string | null;
  runnerScope: RunnerScope;
  // A template runs nowhere and works in no project; a project adds a copy of it.
  template: boolean;
  // The template this row was copied from (copyTemplateIntoProject). Null for a
  // template itself and for an agent nobody copied.
  sourceTemplateId: number | null;
  // Field groups (see template-sync.ts) this copy's owner changed by hand, so the next
  // template sync leaves them alone. Always [] for a template or a plain agent.
  templateOverrides: TemplateFieldGroup[];
  // Last time this copy was synced from its template; null for a template or a plain
  // agent.
  templateSyncedAt: string | null;
  // The agent's token budgets per day and per calendar month (UTC), from helena_budget;
  // null is none. Its other budgets (euros, time) are on the Autopilot routes.
  dailyTokenCeiling: number | null;
  monthlyTokenCeiling: number | null;
  // The agent's own Autopilot level (null follows the project) and whether the owner let
  // it exceed the project's level.
  autopilotLevel: number | null;
  autopilotRaise: boolean;
  // When a runner last polled for this agent, which is what presence is derived
  // from. Null until a runner connects.
  lastSeenAt: string | null;
  // Set while the agent takes no new work, with why.
  pausedAt: string | null;
  pauseReason: string | null;
  createdAt: string;
  // The agent's current API key, for display only — the secret is never returned
  // after creation. start is the key's leading characters kept for identification.
  apiKeyStart: string | null;
  // How many skills and configured tools are enabled, for the meta display.
  skillCount: number;
  toolCount: number;
}

async function mapAgent(row: {
  id: number;
  teamId: number;
  projects: AgentProject[];
  userId: string;
  name: string;
  username: string;
  kind: string;
  agentRole: string;
  projectScope: string;
  model: string | null;
  instructions: string | null;
  runtimePolicy: unknown;
  runtimeState: unknown;
  triggerOnMention: boolean;
  triggerOnAssign: boolean;
  heartbeatIntervalMinutes: number | null;
  heartbeatTimezone: string;
  heartbeatDays: number[];
  heartbeatStart: string;
  heartbeatEnd: string;
  heartbeatInstructions: string;
  heartbeatLastAt: Date | null;
  heartbeatNextAt: Date | null;
  fieldTriggers: FieldTriggerRead[];
  delegationDelaySec: number;
  maxConcurrentChats: number;
  ownerUserId: string | null;
  runnerScope: string;
  template: boolean;
  sourceTemplateId: number | null;
  templateOverrides: unknown;
  templateSyncedAt: Date | null;
  dailyTokenCeiling: number | null;
  monthlyTokenCeiling: number | null;
  autopilotLevel: number | null;
  autopilotRaise: boolean;
  lastSeenAt: Date | null;
  pausedAt: Date | null;
  pauseReason: string | null;
  createdAt: Date;
  apiKeyStart: string | null;
  skillCount: number;
  toolCount: number;
}): Promise<AiAgentRow> {
  return {
    id: row.id,
    teamId: row.teamId,
    projects: row.projects,
    userId: row.userId,
    name: row.agentRole === 'home' ? await getDisplayName() : row.name,
    username: row.username,
    kind: row.kind as AgentKind,
    agentRole: row.agentRole as 'agent' | 'home',
    projectScope: row.projectScope as 'selected' | 'all',
    model: row.model,
    instructions: row.instructions,
    runtimePolicy: normalizeRuntimePolicy(row.runtimePolicy),
    runtimeState: normalizeRuntimeState(row.runtimeState),
    triggerOnMention: row.triggerOnMention,
    triggerOnAssign: row.triggerOnAssign,
    heartbeatIntervalMinutes: row.heartbeatIntervalMinutes,
    heartbeatTimezone: row.heartbeatTimezone,
    heartbeatDays: row.heartbeatDays,
    heartbeatStart: row.heartbeatStart,
    heartbeatEnd: row.heartbeatEnd,
    heartbeatInstructions: row.heartbeatInstructions,
    heartbeatLastAt: row.heartbeatLastAt ? iso(row.heartbeatLastAt) : null,
    heartbeatNextAt: row.heartbeatNextAt ? iso(row.heartbeatNextAt) : null,
    fieldTriggers: row.fieldTriggers,
    delegationDelaySec: row.delegationDelaySec,
    maxConcurrentChats: row.maxConcurrentChats,
    ownerUserId: row.ownerUserId,
    runnerScope: row.runnerScope as RunnerScope,
    template: row.template,
    sourceTemplateId: row.sourceTemplateId,
    templateOverrides: Array.isArray(row.templateOverrides)
      ? (row.templateOverrides as TemplateFieldGroup[])
      : [],
    templateSyncedAt: row.templateSyncedAt ? iso(row.templateSyncedAt) : null,
    dailyTokenCeiling: row.dailyTokenCeiling,
    monthlyTokenCeiling: row.monthlyTokenCeiling,
    autopilotLevel: row.autopilotLevel,
    autopilotRaise: row.autopilotRaise,
    lastSeenAt: row.lastSeenAt ? iso(row.lastSeenAt) : null,
    pausedAt: row.pausedAt ? iso(row.pausedAt) : null,
    pauseReason: row.pauseReason,
    createdAt: iso(row.createdAt),
    apiKeyStart: row.apiKeyStart,
    skillCount: row.skillCount,
    toolCount: row.toolCount,
  };
}

const agentColumns = {
  id: aiAgent.id,
  teamId: aiAgent.teamId,
  // The projects of the agent's own team it is a member of. A membership in a project
  // of another team cannot happen (the attach route refuses it) and is not listed.
  projects: sql<
    AgentProject[]
  >`(select coalesce(json_agg(json_build_object('id', p.id, 'key', p.key, 'name', p.name, 'roleId', pm.role_id, 'roleName', tr.name, 'instructions', pm.description) order by p.key), '[]'::json) from ${projectMember} pm join ${project} p on p.id = pm.project_id left join ${teamRole} tr on tr.id = pm.role_id where pm.user_id = ${aiAgent.userId} and p.team_id = ${aiAgent.teamId})`,
  userId: aiAgent.userId,
  name: user.name,
  username: aiAgent.username,
  kind: aiAgent.kind,
  agentRole: aiAgent.agentRole,
  projectScope: aiAgent.projectScope,
  model: aiAgent.model,
  instructions: aiAgent.instructions,
  runtimePolicy: aiAgent.runtimePolicy,
  runtimeState: aiAgent.runtimeState,
  triggerOnMention: aiAgent.triggerOnMention,
  triggerOnAssign: aiAgent.triggerOnAssign,
  heartbeatIntervalMinutes: aiAgent.heartbeatIntervalMinutes,
  heartbeatTimezone: aiAgent.heartbeatTimezone,
  heartbeatDays: aiAgent.heartbeatDays,
  heartbeatStart: aiAgent.heartbeatStart,
  heartbeatEnd: aiAgent.heartbeatEnd,
  heartbeatInstructions: aiAgent.heartbeatInstructions,
  heartbeatLastAt: aiAgent.heartbeatLastAt,
  heartbeatNextAt: aiAgent.heartbeatNextAt,
  fieldTriggers: sql<
    FieldTriggerRead[]
  >`(select coalesce(json_agg(json_build_object('fieldId', ${agentFieldTrigger.fieldId}, 'name', ${customField.name}, 'delaySec', ${agentFieldTrigger.delaySec}) order by ${customField.name}), '[]'::json) from ${agentFieldTrigger} join ${customField} on ${customField.id} = ${agentFieldTrigger.fieldId} where ${agentFieldTrigger.agentId} = ${aiAgent.id})`,
  delegationDelaySec: aiAgent.delegationDelaySec,
  maxConcurrentChats: aiAgent.maxConcurrentChats,
  ownerUserId: aiAgent.ownerUserId,
  runnerScope: aiAgent.runnerScope,
  template: aiAgent.template,
  sourceTemplateId: aiAgent.sourceTemplateId,
  templateOverrides: aiAgent.templateOverrides,
  templateSyncedAt: aiAgent.templateSyncedAt,
  dailyTokenCeiling: sql<
    number | null
  >`(select b.limit_value::float8 from ${helenaBudget} b where b.agent_id = ${aiAgent.id} and b.metric = 'tokens' and b.period = 'day')`,
  monthlyTokenCeiling: sql<
    number | null
  >`(select b.limit_value::float8 from ${helenaBudget} b where b.agent_id = ${aiAgent.id} and b.metric = 'tokens' and b.period = 'month')`,
  autopilotLevel: aiAgent.autopilotLevel,
  autopilotRaise: aiAgent.autopilotRaise,
  lastSeenAt: aiAgent.lastSeenAt,
  pausedAt: aiAgent.pausedAt,
  pauseReason: aiAgent.pauseReason,
  createdAt: aiAgent.createdAt,
  apiKeyStart: apikey.start,
  skillCount:
    sql<number>`(select count(*) from ${agentSkillLink} where ${agentSkillLink.agentId} = ${aiAgent.id})`.mapWith(
      Number,
    ),
  toolCount:
    sql<number>`(select count(*) from ${agentToolLink} where ${agentToolLink.agentId} = ${aiAgent.id})`.mapWith(
      Number,
    ),
};

// The bot user carries the name and the key row the prefix, so every read of an agent
// joins the two.
function agentQuery() {
  return db
    .select(agentColumns)
    .from(aiAgent)
    .innerJoin(user, eq(user.id, aiAgent.userId))
    .leftJoin(apikey, eq(apikey.referenceId, aiAgent.userId));
}

// Whether the agent is a member of the project, as a condition on a query over
// ai_agent. Membership is held by the bot user, so it is a project_member row of it.
function inProject(projectId: number) {
  return sql`exists (select 1 from ${projectMember} pm where pm.user_id = ${aiAgent.userId} and pm.project_id = ${projectId})`;
}

export type AgentScope = string | { userId: string; allProjects: boolean };

export function agentScopeOf(membership: { role: TeamStanding; userId: string }): AgentScope {
  return { userId: membership.userId, allProjects: runsTeam(membership.role) };
}

// The projects of the team the user is a member of. Attaching an agent to a project
// makes its bot user a member of that one, so the set bounds where someone who does
// not run the team may put an agent.
export async function memberProjectIds(teamId: number, userId: string): Promise<number[]> {
  const rows = await db
    .select({ id: project.id })
    .from(projectMember)
    .innerJoin(project, eq(project.id, projectMember.projectId))
    .where(and(eq(project.teamId, teamId), eq(projectMember.userId, userId)));
  return rows.map((row) => row.id);
}

// Whether the agent works in a project the user is a member of, as a condition on a
// query over ai_agent. Both sides are project_member rows: the agent's bot user and
// the user themselves.
function sharesProjectWith(userId: string) {
  return sql`exists (select 1 from ${projectMember} pm join ${projectMember} mine on mine.project_id = pm.project_id and mine.user_id = ${userId} where pm.user_id = ${aiAgent.userId})`;
}

export function agentVisibility(scope: AgentScope | undefined) {
  if (scope === undefined) return undefined;
  const userId = typeof scope === 'string' ? scope : scope.userId;
  return and(
    typeof scope !== 'string' && scope.allProjects
      ? undefined
      : or(eq(aiAgent.template, true), sharesProjectWith(userId)),
    or(eq(aiAgent.ownerUserId, userId), and(notHomeAgent(), ne(aiAgent.runnerScope, 'owner'))),
  );
}

// The agents of the team, or only the ones working in one of its projects when
// projectId is given, the Home agent left out. visibleToUser narrows the list the way
// agentScopeOf describes; the callers who run the team pass nothing and see them all.
export async function listAgents(
  teamId: number,
  projectId?: number,
  visibleToUser?: AgentScope,
): Promise<AiAgentRow[]> {
  const rows = await agentQuery()
    .where(
      and(
        eq(aiAgent.teamId, teamId),
        projectId == null ? undefined : and(inProject(projectId), notHomeAgent()),
        agentVisibility(visibleToUser),
      ),
    )
    .orderBy(user.name);
  return Promise.all(rows.map(mapAgent));
}

export async function matchAgentQuery(agents: AiAgentRow[], query: string): Promise<AiAgentRow[]> {
  const words = (value: string): string[] =>
    value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const terms = words(query);
  const exact = agents.filter((agent) =>
    [agent.name, agent.username].some(
      (value) => value.toLocaleLowerCase() === query.toLocaleLowerCase(),
    ),
  );
  if (exact.length) return exact;
  const roleRequested = terms.some((term) => ['koordinator', 'coordinator'].includes(term));
  const coordinators = roleRequested
    ? new Set(
        (
          await db
            .select({ id: organizationAgentAssignment.agentId })
            .from(organizationAgentAssignment)
            .where(
              and(
                inArray(
                  organizationAgentAssignment.agentId,
                  agents.map((agent) => agent.id),
                ),
                eq(organizationAgentAssignment.role, 'coordinator'),
              ),
            )
        ).map((row) => row.id),
      )
    : null;
  const remaining = terms.filter((term) => !['koordinator', 'coordinator'].includes(term));
  return agents.filter(
    (agent) =>
      (!coordinators || coordinators.has(agent.id)) &&
      remaining.every((term) =>
        words(
          [agent.name, agent.username, ...agent.projects.map((project) => project.key)].join(' '),
        ).includes(term),
      ),
  );
}

// Scoped to teamId so an id from another team resolves to null, and to visibleTo the
// same way the list is: an agent of a project that user is not in reads as missing.
export async function getAgentById(
  id: number,
  teamId: number,
  visibleToUser?: AgentScope,
): Promise<AiAgentRow | null> {
  const rows = await agentQuery().where(
    and(eq(aiAgent.id, id), eq(aiAgent.teamId, teamId), agentVisibility(visibleToUser)),
  );
  return rows[0] ? mapAgent(rows[0]) : null;
}

// The agent of that id that works in the project, or null. A run addresses an agent
// together with the project it is to work in, and membership is what allows it: an
// agent detached from a project stops running there, whatever was queued for it.
export async function getAgentInProject(
  id: number,
  projectId: number,
  viewerId?: string,
): Promise<AiAgentRow | null> {
  const rows = await agentQuery().where(
    and(eq(aiAgent.id, id), inProject(projectId), agentVisibility(viewerId)),
  );
  return rows[0] ? mapAgent(rows[0]) : null;
}

// An agent may run for whoever triggered it when its runner is team-scoped, and
// otherwise only when the trigger came from the agent's owner. A deleted owner
// does not grant another person access.
export function isTriggerableBy(
  agent: { runnerScope: string; ownerUserId: string | null },
  actorUserId: string | null,
): boolean {
  if (agent.runnerScope !== 'owner') return true;
  return agent.ownerUserId !== null && agent.ownerUserId === actorUserId;
}

const triggerScopeColumns = {
  runnerScope: aiAgent.runnerScope,
  ownerUserId: aiAgent.ownerUserId,
};

// Who a change on an issue counts as coming from, for an agent that takes work only from
// its owner: the actor, and when the actor is an agent's bot user also that agent's owner.
// The Home agent and the coordinators act for the person who owns them, so the owner's
// Home agent can hand a task to the owner's coordinator (Home → coordinators →
// specialists); another member's agent still cannot.
async function triggerActors(actorUserId: string | null): Promise<(string | null)[]> {
  if (!actorUserId) return [null];
  const [agent] = await db
    .select({ ownerUserId: aiAgent.ownerUserId })
    .from(aiAgent)
    .where(eq(aiAgent.userId, actorUserId))
    .limit(1);
  return agent?.ownerUserId ? [actorUserId, agent.ownerUserId] : [actorUserId];
}

function isTriggerableByAny(
  agent: { runnerScope: string; ownerUserId: string | null },
  actors: (string | null)[],
): boolean {
  return actors.some((actor) => isTriggerableBy(agent, actor));
}

// Whether the member may send the agent a task, for the paths that queue a run
// outside the mention and delegation triggers (a schedule). An agent that no longer
// exists reads as triggerable — the caller's own lookup reports it missing.
export async function canTriggerAgent(agentId: number, actorUserId: string): Promise<boolean> {
  const rows = await db
    .select(triggerScopeColumns)
    .from(aiAgent)
    .where(eq(aiAgent.id, agentId))
    .limit(1);
  return !rows[0] || isTriggerableBy(rows[0], actorUserId);
}

// Agents working in the project whose bot user is among the given ids and that react
// to mentions. Turns the user ids parsed from a comment's mentions into the agents that
// should run for the comment's author. An agent of the team that is not a member of
// this project is left out: a mention must not pull a key into a project the team
// never opened it to. A paused agent is left out too: it takes no new work.
export async function listMentionTriggerAgents(
  projectId: number,
  userIds: string[],
  actorUserId: string | null,
): Promise<{ id: number; userId: string }[]> {
  if (userIds.length === 0) return [];
  const rows = await db
    .select({ id: aiAgent.id, userId: aiAgent.userId, ...triggerScopeColumns })
    .from(aiAgent)
    .where(
      and(
        inProject(projectId),
        eq(aiAgent.triggerOnMention, true),
        isNull(aiAgent.pausedAt),
        inArray(aiAgent.userId, userIds),
      ),
    );
  const actors = await triggerActors(actorUserId);
  return rows
    .filter((row) => isTriggerableByAny(row, actors))
    .map((row) => ({ id: row.id, userId: row.userId }));
}

// Why a mention of an agent starts no run of it: the agent works outside the project,
// the text was written by an agent (the loop guard: only a delegation hands one agent's
// work to another), the agent takes work only from its owner, it does not react to
// mentions, or it is paused.
export type MentionRefusal =
  'not-in-project' | 'agent-author' | 'owner-only' | 'mentions-off' | 'paused';

export interface MentionedAgent {
  id: number;
  userId: string;
  username: string;
  name: string;
  // Null when a mention by the author starts the agent.
  refused: MentionRefusal | null;
}

// The agents of the team a text's handles name, each with whether a mention by
// `actorUserId` starts it, by the rules a comment's mentions follow
// (listMentionTriggerAgents): in the project, not written by an agent, the agent reacts to
// mentions, is not paused and takes work from the author. Unlike a comment, which just
// leaves an agent out, the reason is named, for a text that is saved and started later
// (a routine's instructions). Handles that name no agent of the team (a member, plain
// text) are left out; the order is the text's.
export async function mentionedAgents(
  projectId: number,
  teamId: number,
  handles: string[],
  actorUserId: string | null,
): Promise<MentionedAgent[]> {
  if (handles.length === 0) return [];
  const rows = await db
    .select({
      id: aiAgent.id,
      userId: aiAgent.userId,
      username: aiAgent.username,
      name: user.name,
      triggerOnMention: aiAgent.triggerOnMention,
      pausedAt: aiAgent.pausedAt,
      inProject: sql<boolean>`${inProject(projectId)}`,
      ...triggerScopeColumns,
    })
    .from(aiAgent)
    .innerJoin(user, eq(user.id, aiAgent.userId))
    .where(
      and(
        eq(aiAgent.teamId, teamId),
        eq(aiAgent.template, false),
        inArray(sql`lower(${aiAgent.username})`, handles),
      ),
    );
  const byAgent = actorUserId !== null && (await isAgentUser(actorUserId));
  const actors = await triggerActors(actorUserId);
  const refusal = (row: (typeof rows)[number]): MentionRefusal | null => {
    if (!row.inProject) return 'not-in-project';
    if (byAgent) return 'agent-author';
    if (!isTriggerableByAny(row, actors)) return 'owner-only';
    if (!row.triggerOnMention) return 'mentions-off';
    if (row.pausedAt) return 'paused';
    return null;
  };
  const order = new Map(handles.map((handle, index) => [handle, index]));
  return rows
    .map((row) => ({
      id: row.id,
      userId: row.userId,
      username: row.username,
      name: row.name,
      refused: refusal(row),
    }))
    .sort(
      (a, b) =>
        (order.get(a.username.toLowerCase()) ?? 0) - (order.get(b.username.toLowerCase()) ?? 0),
    );
}

// The agent working in the project whose bot user is userId and that reacts to being
// delegated to, or null. Turns a new delegate into the agent that should run on
// delegation. Null for a paused agent.
export async function getAssignTriggerAgent(
  projectId: number,
  userId: string,
  actorUserId: string | null,
): Promise<{ id: number; delegationDelaySec: number } | null> {
  const rows = await db
    .select({
      id: aiAgent.id,
      delegationDelaySec: aiAgent.delegationDelaySec,
      ...triggerScopeColumns,
    })
    .from(aiAgent)
    .where(
      and(
        eq(aiAgent.userId, userId),
        eq(aiAgent.triggerOnAssign, true),
        isNull(aiAgent.pausedAt),
        inProject(projectId),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row || !isTriggerableByAny(row, await triggerActors(actorUserId))) return null;
  return { id: row.id, delegationDelaySec: row.delegationDelaySec };
}

export async function getSubtaskResumeAgent(
  projectId: number,
  userId: string,
  actorUserId: string | null,
): Promise<{ id: number } | null> {
  const [agent] = await db
    .select({ id: aiAgent.id, ...triggerScopeColumns })
    .from(aiAgent)
    .where(and(eq(aiAgent.userId, userId), isNull(aiAgent.pausedAt), inProject(projectId)))
    .limit(1);
  return agent && isTriggerableByAny(agent, await triggerActors(actorUserId))
    ? { id: agent.id }
    : null;
}

// The agent working in the project whose bot user is userId and that reacts to being
// set into that member field, or null. The counterpart of getAssignTriggerAgent for a
// custom field, and null for a paused agent the same way.
export async function getFieldTriggerAgent(
  projectId: number,
  userId: string,
  fieldId: number,
  actorUserId: string | null,
): Promise<{ id: number; delaySec: number } | null> {
  const rows = await db
    .select({
      id: aiAgent.id,
      delaySec: agentFieldTrigger.delaySec,
      ...triggerScopeColumns,
    })
    .from(aiAgent)
    .innerJoin(agentFieldTrigger, eq(agentFieldTrigger.agentId, aiAgent.id))
    .where(
      and(
        eq(aiAgent.userId, userId),
        eq(agentFieldTrigger.fieldId, fieldId),
        isNull(aiAgent.pausedAt),
        inProject(projectId),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row || !isTriggerableByAny(row, await triggerActors(actorUserId))) return null;
  return { id: row.id, delaySec: row.delaySec };
}

// Replaces the member fields an agent reacts to. A field that is not a member field
// holding agents in one of the agent's projects is dropped, so a stale id from a
// client never links.
async function setFieldTriggers(
  agentId: number,
  projectIds: number[],
  triggers: FieldTrigger[],
): Promise<void> {
  const allowed = new Set(await listAgentMemberFieldIds(projectIds));
  const byField = new Map(
    triggers.filter((t) => allowed.has(t.fieldId)).map((t) => [t.fieldId, t.delaySec]),
  );
  await db.transaction(async (tx) => {
    await tx.delete(agentFieldTrigger).where(eq(agentFieldTrigger.agentId, agentId));
    if (byField.size > 0) {
      await tx
        .insert(agentFieldTrigger)
        .values([...byField].map(([fieldId, delaySec]) => ({ agentId, fieldId, delaySec })));
    }
  });
}

// True if the user id is the bot user of an agent working in this project. Validates
// that a delegate is an agent of the project before it is written to an issue, and is
// what keeps the delegation and field triggers off an agent that is not a member.
export async function isProjectAgent(projectId: number, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: aiAgent.id })
    .from(aiAgent)
    .where(and(eq(aiAgent.userId, userId), inProject(projectId)))
    .limit(1);
  return rows.length > 0;
}

// The team of the agent a bot user belongs to, or null when the user is a person.
// An agent belongs to exactly one team, so this is the team its API key acts in.
export async function agentTeam(userId: string): Promise<number | null> {
  const rows = await db
    .select({ teamId: aiAgent.teamId })
    .from(aiAgent)
    .where(eq(aiAgent.userId, userId))
    .limit(1);
  return rows[0]?.teamId ?? null;
}

// True if the user id is an agent's bot user rather than a person's.
export async function isAgentUser(userId: string): Promise<boolean> {
  return (await agentTeam(userId)) !== null;
}

// The projects of the team the agent is to work in. An id that is not a project of the
// team is refused rather than dropped: attaching an agent to a project its team does
// not own would put its key somewhere the team never opened.
async function resolveTeamProjectIds(teamId: number, projectIds: number[]): Promise<number[]> {
  const wanted = [...new Set(projectIds)];
  if (wanted.length === 0) return [];
  const rows = await db
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.teamId, teamId), inArray(project.id, wanted)));
  if (rows.length !== wanted.length) throw new HttpError(400, 'Project not found in this team');
  return rows.map((row) => row.id);
}

async function allTeamProjectIds(teamId: number): Promise<number[]> {
  const rows = await db.select({ id: project.id }).from(project).where(eq(project.teamId, teamId));
  return rows.map((row) => row.id);
}

export interface NewAgentInput {
  name: string;
  username: string;
  // Accepted for the callers that still name it; there is only one kind.
  kind?: AgentKind;
  model?: string | null;
  instructions?: string | null;
  runtimePolicy?: AgentRuntimePolicy;
  // Run triggers. Both are off by default: nothing answers an agent's runs until its
  // operator starts a runner, so an agent added for its API key alone must not collect
  // runs no one drains.
  triggerOnMention?: boolean;
  triggerOnAssign?: boolean;
  heartbeatIntervalMinutes?: number | null;
  heartbeatTimezone?: string;
  heartbeatDays?: number[];
  heartbeatStart?: string;
  heartbeatEnd?: string;
  heartbeatInstructions?: string;
  // The member custom fields that start a run when the agent is set into one.
  fieldTriggers?: FieldTrigger[];
  delegationDelaySec?: number;
  maxConcurrentChats?: number;
  // The projects of the team the agent works in. Empty means it works in none yet:
  // it authenticates and reaches nothing until it is attached to one.
  projectIds?: number[];
  projectScope?: 'selected' | 'all';
  // Set only by the internal bootstrap, never by the public route.
  agentRole?: 'agent' | 'home';
  // The project the agent is created in, in place of projectIds: it works in that
  // project only, as a specialist reporting to the project's coordinator.
  projectId?: number;
  template?: boolean;
  // What a copy of a template carries over: the role title and capabilities of its
  // place in the agent team, its skills and its MCP servers.
  roleTitle?: string;
  capabilities?: string[];
  skillIds?: number[];
  mcpServerIds?: number[];
  // The team's configured tools (agent_tool) to carry over. Only copyTemplateIntoProject
  // sets this today.
  agentToolIds?: number[];
  // Runner scope (default: any member's runs).
  runnerScope?: RunnerScope;
  // The member creating the agent, who owns its runner.
  ownerUserId?: string | null;
  // Set by copyTemplateIntoProject only: links this new row to the template it came
  // from, so a later change to the template can be synced into it (template-sync.ts).
  sourceTemplateId?: number;
}

// The coordinator that leads the project's agent team, or null when it has none.
async function projectCoordinatorId(teamId: number, projectId: number): Promise<number | null> {
  const rows = await db
    .select({ id: aiAgent.id })
    .from(aiAgent)
    .innerJoin(
      organizationAgentAssignment,
      and(
        eq(organizationAgentAssignment.agentId, aiAgent.id),
        eq(organizationAgentAssignment.teamId, aiAgent.teamId),
      ),
    )
    .where(
      and(
        eq(aiAgent.teamId, teamId),
        eq(organizationAgentAssignment.role, 'coordinator'),
        inProject(projectId),
      ),
    )
    .orderBy(asc(aiAgent.id))
    .limit(1);
  return rows[0]?.id ?? null;
}

// A handle addresses one person or one agent, never several: a mention is resolved
// against the members and the agents of the project at once, and by the lowercased
// handle, so a name a member already answers to cannot be issued to an agent and two
// agents of a team cannot differ by case alone. The agents of a team are held to that
// by the unique index on (team_id, lower(username)); the check here turns a conflict
// into a message that names which side took the handle. The reverse check sits in
// @repo/auth, where a member's username is set.
async function assertUsernameFree(
  teamId: number,
  username: string,
  exceptAgentId?: number,
): Promise<void> {
  const handle = username.toLowerCase();
  if ((await db.$count(user, eq(user.username, handle))) > 0)
    throw new HttpError(409, 'A member already uses this username');
  const conflicts = and(
    eq(aiAgent.teamId, teamId),
    eq(sql`lower(${aiAgent.username})`, handle),
    exceptAgentId == null ? undefined : ne(aiAgent.id, exceptAgentId),
  );
  if ((await db.$count(aiAgent, conflicts)) > 0)
    throw new HttpError(409, 'An agent with this username already exists');
}

// Issues a fresh API key owned by the agent's bot user and returns its plaintext
// value (only available at creation). The server-side call sets the owner via
// userId — better-auth allows this only for a direct (non-request) server call.
//
// The key carries no expiry, unlike a personal one: an agent's key is rotated by its
// operator through regenerate-key. The plugin puts its default on every key it
// creates, so the expiry is cleared on the row afterwards.
async function issueKey(userId: string, name: string): Promise<{ key: string; id: string }> {
  const created = await auth.api.createApiKey({ body: { userId, name: agentKeyName(name) } });
  await db.update(apikey).set({ expiresAt: null }).where(eq(apikey.id, created.id));
  return { key: created.key, id: created.id };
}

// The name of an agent's key: "agent:" and the agent's display name. It only labels
// the row; the agent is found through the key's owner, its bot user. The plugin
// refuses a name over API_KEY_MAX_NAME_LENGTH, and a display name has no such limit
// (a template's copy appends the project key, a coordinator carries it), so the
// display name is cut to fit instead of failing the agent's creation or re-key. The
// cut falls between characters, never inside one.
function agentKeyName(name: string): string {
  let keyName = 'agent:';
  for (const { segment } of new Intl.Segmenter().segment(name.trim())) {
    if (keyName.length + segment.length > API_KEY_MAX_NAME_LENGTH) break;
    keyName += segment;
  }
  return keyName.trimEnd();
}

// Creates an agent: a bot user, the ai_agent config row, its team and project
// memberships, and its first API key.
//
// Returns the agent plus the one-time key secret, which its operator must copy.
export async function createAgent(
  teamId: number,
  input: NewAgentInput,
): Promise<{ agent: AiAgentRow; apiKey: string }> {
  const userId = crypto.randomUUID();
  const email = `${userId}@agents.local`;
  if (
    input.template &&
    (input.projectId != null || (input.projectIds?.length ?? 0) > 0 || input.projectScope === 'all')
  ) {
    throw new HttpError(400, 'A template joins no project');
  }
  if (input.projectId != null && input.projectScope === 'all') {
    throw new HttpError(400, 'A project specialist cannot have all-project scope');
  }
  await assertUsernameFree(teamId, input.username);
  const projectIds = await resolveTeamProjectIds(
    teamId,
    input.projectScope === 'all'
      ? await allTeamProjectIds(teamId)
      : input.projectId != null
        ? [input.projectId]
        : (input.projectIds ?? []),
  );
  const coordinatorId =
    input.projectId != null ? await projectCoordinatorId(teamId, input.projectId) : null;
  // An agent joins a project the way a person accepting an invite does: on the team's
  // default role, changed per project from the project's member list afterwards.
  const roleId = await getDefaultRoleId(teamId);
  const schemaModel = await initialAgentModel({
    home: input.agentRole === 'home',
    ...(!input.sourceTemplateId && {
      role: inferModelRole(
        { agentRole: input.agentRole ?? 'agent', username: input.username },
        { role: null, roleTitle: input.roleTitle ?? '', capabilities: input.capabilities ?? [] },
      ),
    }),
    projectIds,
    projectScope: input.projectScope,
    sourceTemplateId: input.sourceTemplateId,
    model: input.model,
    runtimePolicy: input.runtimePolicy as Record<string, unknown> | undefined,
  });

  const clock: HeartbeatClock = {
    heartbeatIntervalMinutes: input.heartbeatIntervalMinutes ?? null,
    heartbeatTimezone: input.heartbeatTimezone ?? 'UTC',
    heartbeatDays: input.heartbeatDays ?? [1, 2, 3, 4, 5],
    heartbeatStart: input.heartbeatStart ?? '09:00',
    heartbeatEnd: input.heartbeatEnd ?? '17:00',
  };
  try {
    validateHeartbeatClock(clock);
  } catch (error) {
    throw new HttpError(400, String(error));
  }
  const agentId = await db.transaction(async (tx) => {
    await tx
      .insert(user)
      .values({ id: userId, name: input.name, email, emailVerified: false, role: 'user' });
    try {
      const [row] = await tx
        .insert(aiAgent)
        .values({
          teamId,
          userId,
          username: input.username,
          agentRole: input.agentRole ?? 'agent',
          modelRole: schemaModel.role,
          modelOverrides: schemaModel.overrides,
          projectScope: input.projectScope ?? 'selected',
          kind: 'external',
          model: schemaModel.model,
          instructions: input.instructions ?? null,
          runtimePolicy: normalizeRuntimePolicy(schemaModel.runtimePolicy),
          triggerOnMention: input.triggerOnMention ?? false,
          triggerOnAssign: input.triggerOnAssign ?? false,
          ...clock,
          heartbeatInstructions: input.heartbeatInstructions ?? '',
          heartbeatNextAt: input.template ? null : nextHeartbeatAt(clock, new Date()),
          delegationDelaySec: input.delegationDelaySec,
          maxConcurrentChats: input.maxConcurrentChats,
          ownerUserId: input.ownerUserId ?? null,
          runnerScope: input.runnerScope ?? 'team',
          template: input.template ?? false,
          sourceTemplateId: input.sourceTemplateId ?? null,
          templateSyncedAt: input.sourceTemplateId != null ? new Date() : null,
        })
        .returning({ id: aiAgent.id });
      // The agent belongs to the team's member list like a person does, on a standing
      // of its own that closes the owner and manager guards to it.
      await tx.insert(teamMember).values({ teamId, userId, role: 'agent' });
      if (projectIds.length > 0) {
        await tx
          .insert(projectMember)
          .values(projectIds.map((projectId) => ({ projectId, userId, role: 'member', roleId })));
      }
      if (input.projectId != null) {
        await tx.insert(organizationAgentAssignment).values({
          teamId,
          agentId: row.id,
          role: 'specialist',
          reportsToAgentId: coordinatorId,
          roleTitle: input.roleTitle ?? '',
          capabilities: input.capabilities ?? [],
        });
      }
      if (input.skillIds?.length) {
        await tx
          .insert(agentSkillLink)
          .values(input.skillIds.map((skillId) => ({ agentId: row.id, skillId })));
      }
      if (input.mcpServerIds?.length) {
        await tx
          .insert(agentMcpServerLink)
          .values(input.mcpServerIds.map((mcpServerId) => ({ agentId: row.id, mcpServerId })));
      }
      if (input.agentToolIds?.length) {
        await tx
          .insert(agentToolLink)
          .values(input.agentToolIds.map((agentToolId) => ({ agentId: row.id, agentToolId })));
      }
      return row.id;
    } catch (err) {
      rethrowDuplicate(err, 'An agent with this username');
      throw err;
    }
  });

  if (input.fieldTriggers?.length) {
    await setFieldTriggers(agentId, projectIds, input.fieldTriggers);
  }

  // Issued outside the transaction: better-auth writes the key through its own
  // connection, so it cannot join this one. A key that fails to issue (e.g. the
  // combined name is too long for better-auth's apiKey plugin) must not leave a
  // half-created agent behind: with the row already committed, a retry with the same
  // username would otherwise fail with 409 instead of the original error, hiding it.
  let apiKey: string;
  try {
    apiKey = (await issueKey(userId, input.name)).key;
  } catch (err) {
    await deleteAgent(agentId, teamId);
    throw err;
  }
  await queueAgentRuntime(userId);
  const agent = (await getAgentById(agentId, teamId))!;
  return { agent, apiKey };
}

// Queues the provisioning of these projects again, so the integration service creates
// or removes the Hermes runtimes of their agents. The new id makes it a new request for
// the service's ledger.
async function queueRuntimeProvisioning(projectIds: number[]): Promise<void> {
  const ids = [...new Set(projectIds)];
  if (ids.length === 0) return;
  await db
    .update(projectProvisioningJob)
    .set({
      id: sql`gen_random_uuid()`,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: new Date(),
      lastError: null,
      result: null,
      completedAt: null,
      updatedAt: new Date(),
    })
    .where(inArray(projectProvisioningJob.projectId, ids));
}

// An agent has a Hermes runtime only while it works in exactly one project, so a change
// to its projects queues all of them and the ones it left.
export async function queueAgentRuntime(
  userId: string,
  leftProjectIds: number[] = [],
): Promise<void> {
  const rows = await db
    .select({ projectId: projectMember.projectId })
    .from(aiAgent)
    .leftJoin(projectMember, eq(projectMember.userId, aiAgent.userId))
    .where(eq(aiAgent.userId, userId));
  if (rows.length === 0) return;
  await queueRuntimeProvisioning([
    ...leftProjectIds,
    ...rows.flatMap((row) => (row.projectId == null ? [] : [row.projectId])),
  ]);
}

// Replaces the projects the agent works in. Membership is what gives its key access,
// so this is the whole of attaching and detaching: a project left out is detached, and
// the runs, threads and issues it produced there are untouched. A project it already
// works in keeps the role that membership carries.
async function setAgentProjects(agent: AiAgentRow, projectIds: number[]): Promise<number[]> {
  const wanted = await resolveTeamProjectIds(agent.teamId, projectIds);
  const roleId = await getDefaultRoleId(agent.teamId);
  await db.transaction(async (tx) => {
    await tx
      .delete(projectMember)
      .where(
        and(
          eq(projectMember.userId, agent.userId),
          wanted.length > 0 ? notInArray(projectMember.projectId, wanted) : undefined,
        ),
      );
    // A column cannot keep assigning issues to an agent that no longer works in the
    // project, the same rule remove_member follows.
    await tx
      .update(projectColumn)
      .set({ autoAssignUserId: null })
      .where(
        and(
          eq(projectColumn.autoAssignUserId, agent.userId),
          wanted.length > 0 ? notInArray(projectColumn.projectId, wanted) : undefined,
        ),
      );
    if (wanted.length > 0) {
      await tx
        .insert(projectMember)
        .values(
          wanted.map((projectId) => ({
            projectId,
            userId: agent.userId,
            role: 'member',
            roleId,
          })),
        )
        .onConflictDoNothing();
    }
  });
  return wanted;
}

export interface AgentPatch {
  name?: string;
  username?: string;
  // The projects the agent works in. Replaces the set, so a project left out is
  // detached.
  projectIds?: number[];
  projectScope?: 'selected' | 'all';
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
  fieldTriggers?: FieldTrigger[];
  delegationDelaySec?: number;
  maxConcurrentChats?: number;
  runnerScope?: RunnerScope;
  // Turning it on detaches the agent from every project.
  template?: boolean;
}

export async function updateAgent(
  id: number,
  teamId: number,
  patch: AgentPatch,
  // The member making the change: choosing the 'owner' scope means their own runs.
  actorUserId: string,
): Promise<AiAgentRow | null> {
  const agent = await getAgentById(id, teamId);
  if (!agent) return null;
  if (patch.template && agent.agentRole === 'home') {
    throw new HttpError(400, 'The Home agent cannot be a template');
  }
  const template = patch.template ?? agent.template;
  if (template && (patch.projectIds?.length ?? 0) > 0) {
    throw new HttpError(400, 'A template joins no project');
  }
  if (template && patch.projectScope === 'all') {
    throw new HttpError(400, 'A template cannot have all-project scope');
  }

  // The display name lives on the bot user.
  if (patch.name !== undefined) {
    await db.update(user).set({ name: patch.name }).where(eq(user.id, agent.userId));
  }

  // Which template field groups this patch touches (template-sync.ts), gathered before
  // `set` is written so the runtimePolicy comparison still has the agent's previous
  // value to diff against.
  const changedGroups: TemplateFieldGroup[] = [];
  if (patch.instructions !== undefined && patch.instructions !== agent.instructions) {
    changedGroups.push('instructions');
  }
  if (patch.model !== undefined && patch.model !== agent.model) {
    changedGroups.push('model');
  }
  if (patch.runtimePolicy !== undefined) {
    changedGroups.push(
      ...runtimePolicyGroupsChanged(
        agent.runtimePolicy,
        normalizeRuntimePolicy(patch.runtimePolicy),
      ),
    );
  }

  const set: Partial<typeof aiAgent.$inferInsert> = {};
  if (patch.model !== undefined || patch.runtimePolicy !== undefined) {
    const [stored] = await db
      .select({ overrides: aiAgent.modelOverrides })
      .from(aiAgent)
      .where(eq(aiAgent.id, id));
    const overrides = { ...stored?.overrides };
    if (patch.model !== undefined) overrides.model = patch.model;
    if (patch.runtimePolicy !== undefined) {
      const policy = normalizeRuntimePolicy(patch.runtimePolicy);
      overrides.runtime = policy.runtime ?? 'hermes';
      overrides.reasoning = policy.reasoningEffort;
      if (policy.helena?.toolProfile) overrides.toolProfile = policy.helena.toolProfile;
      else delete overrides.toolProfile;
      if (policy.escalation) {
        overrides.escalation = policy.escalation;
      }
    }
    set.modelOverrides = overrides;
  }
  if (patch.username !== undefined) {
    await assertUsernameFree(teamId, patch.username, id);
    set.username = patch.username;
  }
  if (patch.model !== undefined) set.model = patch.model;
  if (patch.instructions !== undefined) set.instructions = patch.instructions;
  if (patch.runtimePolicy !== undefined)
    set.runtimePolicy = normalizeRuntimePolicy(patch.runtimePolicy);
  if (patch.triggerOnMention !== undefined) set.triggerOnMention = patch.triggerOnMention;
  if (patch.triggerOnAssign !== undefined) set.triggerOnAssign = patch.triggerOnAssign;
  const clock: HeartbeatClock = {
    heartbeatIntervalMinutes:
      patch.heartbeatIntervalMinutes === undefined
        ? agent.heartbeatIntervalMinutes
        : patch.heartbeatIntervalMinutes,
    heartbeatTimezone: patch.heartbeatTimezone ?? agent.heartbeatTimezone,
    heartbeatDays: patch.heartbeatDays ?? agent.heartbeatDays,
    heartbeatStart: patch.heartbeatStart ?? agent.heartbeatStart,
    heartbeatEnd: patch.heartbeatEnd ?? agent.heartbeatEnd,
  };
  try {
    validateHeartbeatClock(clock);
  } catch (error) {
    throw new HttpError(400, String(error));
  }
  if (
    clock.heartbeatIntervalMinutes !== agent.heartbeatIntervalMinutes ||
    clock.heartbeatTimezone !== agent.heartbeatTimezone ||
    clock.heartbeatDays.join(',') !== agent.heartbeatDays.join(',') ||
    clock.heartbeatStart !== agent.heartbeatStart ||
    clock.heartbeatEnd !== agent.heartbeatEnd ||
    template !== agent.template
  ) {
    Object.assign(set, clock);
    set.heartbeatNextAt = template ? null : nextHeartbeatAt(clock, new Date());
  }
  if (patch.heartbeatInstructions !== undefined)
    set.heartbeatInstructions = patch.heartbeatInstructions;
  if (patch.delegationDelaySec !== undefined) set.delegationDelaySec = patch.delegationDelaySec;
  if (patch.maxConcurrentChats !== undefined) set.maxConcurrentChats = patch.maxConcurrentChats;
  if (patch.template !== undefined) set.template = patch.template;
  const projectScope = template
    ? 'selected'
    : (patch.projectScope ?? (patch.projectIds !== undefined ? 'selected' : agent.projectScope));
  if (projectScope !== agent.projectScope) {
    set.projectScope = projectScope;
  }
  // The scope and its owner are one setting: 'owner' means the runs of the member who
  // chose it, so switching to it hands the agent to them.
  if (patch.runnerScope !== undefined) {
    set.runnerScope = patch.runnerScope;
    if (patch.runnerScope === 'owner') set.ownerUserId = actorUserId;
  }
  if (Object.keys(set).length > 0) {
    try {
      await db
        .update(aiAgent)
        .set(set)
        .where(and(eq(aiAgent.id, id), eq(aiAgent.teamId, teamId)));
    } catch (err) {
      rethrowDuplicate(err, 'An agent with this username');
      throw err;
    }
  }
  // The projects go first, so a field trigger of a project the same call attaches is
  // kept rather than dropped as unknown.
  const previousProjectIds = agent.projects.map((p) => p.id);
  const wanted = template
    ? []
    : projectScope === 'all' && (patch.projectScope !== undefined || patch.projectIds !== undefined)
      ? await allTeamProjectIds(teamId)
      : patch.projectIds;
  const projectIds =
    wanted !== undefined ? await setAgentProjects(agent, wanted) : previousProjectIds;
  if (patch.fieldTriggers !== undefined) {
    await setFieldTriggers(id, projectIds, patch.fieldTriggers);
  }
  const projectsChanged =
    projectIds.length !== previousProjectIds.length ||
    projectIds.some((projectId) => !previousProjectIds.includes(projectId));
  if (projectsChanged) await syncAgentModel(id);
  // The runner descriptor names the agent by its username, and only a Hermes agent has one.
  const runtimeChanged =
    patch.runtimePolicy !== undefined &&
    (normalizeRuntimePolicy(patch.runtimePolicy).runtime ?? 'hermes') !==
      (agent.runtimePolicy.runtime ?? 'hermes');
  if (
    projectsChanged ||
    runtimeChanged ||
    (patch.username !== undefined && patch.username !== agent.username)
  ) {
    await queueAgentRuntime(agent.userId, previousProjectIds);
  }

  if (changedGroups.length > 0) {
    await onTemplateRelevantChange(id, [...new Set(changedGroups)]);
  }

  return getAgentById(id, teamId);
}

// A copy of a template for one project: a specialist of that project with the
// template's configuration, skills, MCP servers and capabilities. Knowledge the copies share goes
// through the skills; each copy keeps a memory of its own.
// A template whose model the provider refused this account gives its copy the runtime's
// default model instead ("Agenten-Standard"), and says so in `modelFallback`: a copy that
// cannot run is no copy.
export async function copyTemplateIntoProject(
  template: AiAgentRow,
  projectId: number,
  ownerUserId: string,
): Promise<{
  agent: AiAgentRow;
  apiKey: string;
  modelFallback?: { model: string; detail: string | null };
}> {
  if (!template.template) throw new HttpError(400, 'Only a template can be copied into a project');
  const [target] = await db
    .select({ key: project.key })
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.teamId, template.teamId)));
  if (!target) throw new HttpError(400, 'Project not found in this team');
  const suffix = `-${target.key.toLowerCase()}`;
  const [assignment, skills, mcpServers, agentTools] = await Promise.all([
    db
      .select({
        roleTitle: organizationAgentAssignment.roleTitle,
        capabilities: organizationAgentAssignment.capabilities,
      })
      .from(organizationAgentAssignment)
      .where(eq(organizationAgentAssignment.agentId, template.id))
      .then((rows) => rows[0]),
    db
      .select({ skillId: agentSkillLink.skillId })
      .from(agentSkillLink)
      .where(eq(agentSkillLink.agentId, template.id)),
    db
      .select({ mcpServerId: agentMcpServerLink.mcpServerId })
      .from(agentMcpServerLink)
      .where(eq(agentMcpServerLink.agentId, template.id)),
    db
      .select({ agentToolId: agentToolLink.agentToolId })
      .from(agentToolLink)
      .where(eq(agentToolLink.agentId, template.id)),
  ]);
  const refusal = await agentModelRefusal(template);
  const created = await createAgent(template.teamId, {
    name: `${template.name} ${target.key}`,
    username: template.username.slice(0, 64 - suffix.length) + suffix,
    model: refusal ? null : template.model,
    instructions: template.instructions,
    // The template's reasoning level belongs to its model (the editor's rule).
    runtimePolicy: refusal
      ? { ...template.runtimePolicy, reasoningEffort: null }
      : template.runtimePolicy,
    triggerOnMention: template.triggerOnMention,
    triggerOnAssign: template.triggerOnAssign,
    heartbeatIntervalMinutes: template.heartbeatIntervalMinutes,
    heartbeatTimezone: template.heartbeatTimezone,
    heartbeatDays: template.heartbeatDays,
    heartbeatStart: template.heartbeatStart,
    heartbeatEnd: template.heartbeatEnd,
    heartbeatInstructions: template.heartbeatInstructions,
    delegationDelaySec: template.delegationDelaySec,
    maxConcurrentChats: template.maxConcurrentChats,
    runnerScope: template.runnerScope,
    ownerUserId,
    projectId,
    roleTitle: assignment?.roleTitle,
    capabilities: assignment?.capabilities,
    skillIds: skills.map(({ skillId }) => skillId),
    mcpServerIds: mcpServers.map(({ mcpServerId }) => mcpServerId),
    agentToolIds: agentTools.map(({ agentToolId }) => agentToolId),
    sourceTemplateId: template.id,
  });
  if (refusal) {
    await db
      .update(aiAgent)
      .set({
        model: null,
        runtimePolicy: { ...created.agent.runtimePolicy, reasoningEffort: null },
      })
      .where(eq(aiAgent.id, created.agent.id));
  }
  // The Autopilot level ('approvals' group) and the budgets ('budgets' group) follow the
  // template like the rest of its configuration.
  await copyAgentLevel(template.id, created.agent.id);
  await copyAgentBudgets(template.id, created.agent.id);
  return {
    ...created,
    agent: (await getAgentById(created.agent.id, template.teamId))!,
    ...(refusal &&
      template.model && { modelFallback: { model: template.model, detail: refusal.detail } }),
  };
}

// "Pool erweitern" (Auftrag 117): a new template in the team's pool from an agent that
// works somewhere — its instructions, model, runtime policy, skills, tools, MCP servers,
// role and capabilities, Autopilot level and budgets — so projects can add copies of it.
// The agent itself stays as it is. The template works in no project; its handle is the
// agent's with "-vorlage" (numbered when that is taken).
export async function saveAgentAsTemplate(
  agentRow: AiAgentRow,
  ownerUserId: string,
  name?: string,
): Promise<{ agent: AiAgentRow; apiKey: string }> {
  if (agentRow.template) throw new HttpError(400, 'The agent is a template already');
  const [assignment, skills, mcpServers, agentTools] = await Promise.all([
    db
      .select({
        roleTitle: organizationAgentAssignment.roleTitle,
        capabilities: organizationAgentAssignment.capabilities,
      })
      .from(organizationAgentAssignment)
      .where(eq(organizationAgentAssignment.agentId, agentRow.id))
      .then((rows) => rows[0]),
    db
      .select({ skillId: agentSkillLink.skillId })
      .from(agentSkillLink)
      .where(eq(agentSkillLink.agentId, agentRow.id)),
    db
      .select({ mcpServerId: agentMcpServerLink.mcpServerId })
      .from(agentMcpServerLink)
      .where(eq(agentMcpServerLink.agentId, agentRow.id)),
    db
      .select({ agentToolId: agentToolLink.agentToolId })
      .from(agentToolLink)
      .where(eq(agentToolLink.agentId, agentRow.id)),
  ]);
  const base = agentRow.username.slice(0, 64 - '-vorlage-99'.length);
  let username: string | null = null;
  for (let number = 1; number <= 99 && !username; number += 1) {
    const candidate = number === 1 ? `${base}-vorlage` : `${base}-vorlage-${number}`;
    try {
      await assertUsernameFree(agentRow.teamId, candidate);
      username = candidate;
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 409) throw error;
    }
  }
  if (!username) throw new HttpError(409, 'No free handle is left for the template');
  const created = await createAgent(agentRow.teamId, {
    name: name?.trim() || agentRow.name,
    username,
    model: agentRow.model,
    instructions: agentRow.instructions,
    runtimePolicy: agentRow.runtimePolicy,
    triggerOnMention: agentRow.triggerOnMention,
    triggerOnAssign: agentRow.triggerOnAssign,
    heartbeatIntervalMinutes: agentRow.heartbeatIntervalMinutes,
    heartbeatTimezone: agentRow.heartbeatTimezone,
    heartbeatDays: agentRow.heartbeatDays,
    heartbeatStart: agentRow.heartbeatStart,
    heartbeatEnd: agentRow.heartbeatEnd,
    heartbeatInstructions: agentRow.heartbeatInstructions,
    delegationDelaySec: agentRow.delegationDelaySec,
    maxConcurrentChats: agentRow.maxConcurrentChats,
    runnerScope: agentRow.runnerScope,
    ownerUserId,
    template: true,
    roleTitle: assignment?.roleTitle,
    capabilities: assignment?.capabilities,
    skillIds: skills.map(({ skillId }) => skillId),
    mcpServerIds: mcpServers.map(({ mcpServerId }) => mcpServerId),
    agentToolIds: agentTools.map(({ agentToolId }) => agentToolId),
  });
  await copyAgentLevel(agentRow.id, created.agent.id);
  await copyAgentBudgets(agentRow.id, created.agent.id);
  return { ...created, agent: (await getAgentById(created.agent.id, agentRow.teamId))! };
}

// Replaces the agent's API key: deletes the current key row(s) for the bot user
// and issues a new one. Returns the new plaintext secret, or null if the agent
// does not exist. There is no atomic rotate in the plugin, so this is delete+create.
export async function regenerateKey(id: number, teamId: number): Promise<string | null> {
  const agent = await getAgentById(id, teamId);
  if (!agent) return null;
  // Issue the replacement before dropping the old key(s): if issueKey fails (the same
  // name-length limit createAgent can hit), the agent keeps working on its current key
  // instead of being left with none until someone retries.
  const issued = await issueKey(agent.userId, agent.name);
  await db
    .delete(apikey)
    .where(and(eq(apikey.referenceId, agent.userId), ne(apikey.id, issued.id)));
  return issued.key;
}

// Deletes an agent: its API key row(s), then the bot user. Deleting the user cascades
// to the ai_agent row (ON DELETE CASCADE on user_id) and from there to its chats, sets
// assignee_user_id to NULL on every issue the agent was on, and nulls the actor on its
// activity.
export async function deleteAgent(id: number, teamId: number): Promise<boolean> {
  const agent = await getAgentById(id, teamId);
  if (!agent) return false;
  await db.delete(apikey).where(eq(apikey.referenceId, agent.userId));
  await deleteAccount(agent.userId);
  await queueRuntimeProvisioning(agent.projects.map((p) => p.id));
  return true;
}

// True if the agent belongs to the team (guards addressing an agent by id).
export async function agentInTeam(
  agentId: number,
  teamId: number,
  visibleToUser?: AgentScope,
): Promise<boolean> {
  const rows = await db
    .select({ id: aiAgent.id })
    .from(aiAgent)
    .where(and(eq(aiAgent.id, agentId), eq(aiAgent.teamId, teamId), agentVisibility(visibleToUser)))
    .limit(1);
  return rows.length > 0;
}

// True if the agent works in the project (guards naming an agent for work there).
export async function agentWorksInProject(agentId: number, projectId: number): Promise<boolean> {
  const rows = await db
    .select({ id: aiAgent.id })
    .from(aiAgent)
    .where(and(eq(aiAgent.id, agentId), inProject(projectId)))
    .limit(1);
  return rows.length > 0;
}
