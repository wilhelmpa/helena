import {
  db,
  agentRun,
  approvalRequest,
  getDisplayName,
  helenaPolicyDecision,
  issue,
  project,
} from '@repo/db';
import { and, eq, lt } from 'drizzle-orm';
import { intEnv } from '#shared/lib';
import {
  ACTION_CATEGORIES,
  AUTOPILOT_LEVEL_KEYS,
  AUTOPILOT_LEVELS,
  approvalKindOf,
  categoryOfApprovalKind,
  type ActionCategory,
  type ApprovalKind,
  type ActionScope,
  type AutopilotLevel,
  type LevelSource,
  type PolicyDecision,
} from '@helena/policy';
import { policyEvaluator } from '@helena/policy/cedar';
import { budgetExhausted } from './budgets';
import { resolveLevel } from './levels';

// The policy engine of Helena (docs/helena-decisions/policy-engine.md): the one place every
// tool, connector, workflow step and runtime asks "may this agent do this here?". It works
// out the facts from the database (the level that applies, whether a budget is used up,
// whether a person approved exactly this command), lets the Cedar policy set decide, and
// logs the decision.

// Who asks: the adapter that turned an action into a category.
export type PolicyAdapter =
  | 'hermes'
  | 'claude'
  | 'codex'
  | 'mcp'
  | 'gateway'
  | 'workflow'
  | 'approval'
  | 'chat'
  | (string & {});

export interface DecideInput {
  adapter: PolicyAdapter;
  agentId: number | null;
  teamId?: number | null;
  projectId: number | null;
  runId?: number | null;
  chatMessageId?: number | null;
  category: ActionCategory;
  scope?: ActionScope;
  tool?: string | null;
  // What was attempted, in one line, for the log and the approval card.
  summary?: string | null;
  // The exact command or code: when a person approved exactly this in a request whose
  // decision started this run, it may run.
  command?: string | null;
  // Set only after a trusted adapter matches an approved request to the exact task target.
  approvedByTask?: boolean;
  // Whether the decision is logged. A plain read is not, unless denied.
  audit?: boolean;
}

export interface EngineDecision extends PolicyDecision {
  category: ActionCategory;
  scope: ActionScope;
  level: AutopilotLevel;
  levelSource: LevelSource;
  // The id of the logged decision.
  decisionId: number | null;
  // What the agent reads when the action is not allowed.
  message: string;
}

// A command approval names exactly one command. A tool approval without a command is
// reusable only for delete_issue when the approved issue key matches the actual input.
export async function actionApproved(
  agentId: number,
  runId: number | null | undefined,
  category: ActionCategory,
  command: string | null | undefined,
  tool?: string | null,
  summary?: string | null,
  projectId?: number | null,
): Promise<boolean> {
  if (runId == null) return false;
  const rows = await db
    .select({
      command: approvalRequest.command,
      kind: approvalRequest.kind,
      category: approvalRequest.category,
      action: approvalRequest.action,
      projectId: approvalRequest.projectId,
    })
    .from(approvalRequest)
    .where(
      and(
        eq(approvalRequest.agentId, agentId),
        eq(approvalRequest.followUpRunId, runId),
        eq(approvalRequest.status, 'approved'),
      ),
    );
  const text = command?.trim() || null;
  if (text)
    return rows.some(
      (row) =>
        row.command?.trim() === text &&
        row.projectId === projectId &&
        (row.category ?? categoryOfApprovalKind(row.kind as ApprovalKind)) === category,
    );
  if (category !== 'delete' || tool !== 'delete_issue' || !summary || projectId == null)
    return false;
  const target = /"issueId"\s*:\s*(\d+)/.exec(summary);
  if (!target) return false;
  const [item] = await db
    .select({ key: project.key, sequence: issue.sequenceNumber })
    .from(issue)
    .innerJoin(project, eq(project.id, issue.projectId))
    .where(and(eq(issue.id, Number(target[1])), eq(issue.projectId, projectId)));
  if (!item) return false;
  const issueKey = item.key + '-' + item.sequence;
  return rows.some((row) => {
    const keys = row.action.toUpperCase().match(/\b[A-Z][A-Z0-9]*-\d+\b/g) ?? [];
    return (
      row.projectId === projectId &&
      row.command == null &&
      row.kind === 'delete' &&
      keys.length === 1 &&
      keys[0] === issueKey.toUpperCase()
    );
  });
}

const LEVEL_NAMES: Record<AutopilotLevel, string> = {
  0: 'Propose',
  1: 'With approval',
  2: 'Act & report',
  3: 'Autonomous within budget',
};

export function levelName(level: AutopilotLevel): string {
  return `${level} (${LEVEL_NAMES[level]})`;
}

function agentMessage(
  decision: PolicyDecision,
  facts: {
    category: ActionCategory;
    scope: ActionScope;
    level: AutopilotLevel;
    command: boolean;
  },
  displayName = 'Ava',
): string {
  if (decision.outcome === 'allow') return '';
  const what = `${facts.category}${facts.category === 'delete' || facts.category === 'execute' ? ` (${facts.scope === 'workspace' ? 'inside' : 'outside'} your workspace)` : ''}`;
  if (decision.outcome === 'deny') {
    const why =
      decision.reason === 'budget-exhausted'
        ? 'a budget of yours or of this project is used up'
        : (decision.detail ?? 'a policy forbids it');
    return (
      `BLOCKED by ${displayName}'s Autopilot: this ${what} action is not allowed because ${why}. ` +
      'Do not try to reach the same result another way; end the run and report where you stopped.'
    );
  }
  const why =
    decision.reason === 'hard-block'
      ? 'it is one a person always approves'
      : decision.reason === 'policy'
        ? (decision.detail ?? 'a policy asks for it')
        : `the project's Autopilot level ${levelName(facts.level)} asks for it`;
  return (
    `BLOCKED by ${displayName}'s Autopilot: this ${what} action needs a person's approval first (${why}). ` +
    `If it is needed, call ${displayName}'s request_approval tool with kind "${approvalKindOf(facts.category)}", ` +
    `the action in one line and every detail a person needs to decide${facts.command ? ', and exactly this command in `command`' : ''}; ` +
    `then end your run without taking the action. ${displayName} starts a new run of yours with the ` +
    'decision. Do not reach the same result another way.'
  );
}

export async function decide(input: DecideInput): Promise<EngineDecision> {
  const scope = input.scope ?? 'workspace';
  const resolved = await resolveLevel(input.agentId, input.projectId);
  const [exhausted, approved] = await Promise.all([
    input.category === 'read' || input.category === 'report'
      ? Promise.resolve(null)
      : budgetExhausted(input.agentId, input.projectId, input.runId),
    input.agentId == null
      ? Promise.resolve(false)
      : actionApproved(
          input.agentId,
          input.runId,
          input.category,
          input.command,
          input.tool,
          input.summary,
          input.projectId,
        ),
  ]);
  const decision = policyEvaluator().evaluate({
    agentId: input.agentId,
    projectId: input.projectId,
    category: input.category,
    scope,
    level: resolved.level,
    approved: approved || input.approvedByTask === true,
    budgetExhausted: exhausted !== null,
  });
  const plainRead =
    (input.category === 'read' || input.category === 'report') && decision.outcome === 'allow';
  let decisionId: number | null = null;
  if (input.audit ?? !plainRead) {
    const [row] = await db
      .insert(helenaPolicyDecision)
      .values({
        teamId: input.teamId ?? null,
        projectId: input.projectId,
        agentId: input.agentId,
        runId: input.runId ?? null,
        chatMessageId: input.chatMessageId ?? null,
        adapter: input.adapter,
        tool: input.tool?.slice(0, 200) ?? null,
        category: input.category,
        scope,
        outcome: decision.outcome,
        level: resolved.level,
        levelSource: resolved.source,
        reason: decision.reason,
        policyIds: decision.policyIds,
        summary:
          (input.summary ?? input.command)?.replace(/\s+/g, ' ').trim().slice(0, 500) ?? null,
      })
      .returning({ id: helenaPolicyDecision.id });
    decisionId = row?.id ?? null;
  }
  return {
    ...decision,
    category: input.category,
    scope,
    level: resolved.level,
    levelSource: resolved.source,
    decisionId,
    message: agentMessage(
      decision,
      {
        category: input.category,
        scope,
        level: resolved.level,
        command: Boolean(input.command),
      },
      await getDisplayName(),
    ),
  };
}

// What a level means, category by category, as the engine decides it (no approval, no used
// budget). The settings page's "Agenten in diesem Projekt dürfen …" and the Autopilot
// section of an agent's prompt are built from this, so the matrix exists only once: in the
// policy set.
export interface LevelRule {
  category: ActionCategory;
  scope: ActionScope | null;
  outcome: PolicyDecision['outcome'];
  reason: PolicyDecision['reason'];
}

export function levelRules(level: AutopilotLevel): LevelRule[] {
  const engine = policyEvaluator();
  return ACTION_CATEGORIES.flatMap((category) => {
    const scopes: (ActionScope | null)[] =
      category === 'delete' || category === 'execute' ? ['workspace', 'external'] : [null];
    return scopes.map((scope) => {
      const decision = engine.evaluate({
        agentId: null,
        projectId: null,
        category,
        scope: scope ?? 'workspace',
        level,
      });
      return { category, scope, outcome: decision.outcome, reason: decision.reason };
    });
  });
}

export function allLevelRules(): { level: AutopilotLevel; key: string; rules: LevelRule[] }[] {
  return AUTOPILOT_LEVELS.map((level) => ({
    level,
    key: AUTOPILOT_LEVEL_KEYS[level],
    rules: levelRules(level),
  }));
}

// The Autopilot level of a run, noted when it is claimed, for its badge.
export async function noteRunLevel(runId: number, level: AutopilotLevel): Promise<void> {
  await db.update(agentRun).set({ autopilotLevel: level }).where(eq(agentRun.id, runId));
}

// The decision log keeps this many days (HELENA_POLICY_LOG_DAYS, 90 by default); the
// background loop drops what is older once a day.
export async function prunePolicyDecisions(
  days = intEnv('HELENA_POLICY_LOG_DAYS', 90),
): Promise<number> {
  const rows = await db
    .delete(helenaPolicyDecision)
    .where(lt(helenaPolicyDecision.createdAt, new Date(Date.now() - days * 86_400_000)))
    .returning({ id: helenaPolicyDecision.id });
  return rows.length;
}
