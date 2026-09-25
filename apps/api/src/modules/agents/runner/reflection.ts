import type { AgentRuntimePolicy } from '../core/service';

// A reflection is a short follow-up turn in the session of a run, in which the agent keeps
// what the run taught it: memory, and skills it creates or patches. Hermes' own post-turn
// review does the same, but in a thread the one-shot process of a run ends before it
// finishes; this turn runs to its end and its tokens are counted with the run.

export type ReflectionReason = 'failure' | 'rework' | 'complex';

// Hermes asks for a skill review after this many tool calls in a turn.
export const COMPLEX_TOOL_CALLS = 10;

export const REFLECTION_LIMITS = { maxTurns: 8, runBudgetSeconds: 120 };

// A reflection on the local model (Lokale KI's class `reflection`): only after a run that read
// at most this much in all its model calls together. That bounds the session the reflection
// resumes (Hermes reports no context size of its own), so its prefill on the workhorse stays
// around a minute (~1,000 tokens/s at 32–64k, docs/helena-decisions/local-ai-platform.md §4.3);
// a larger one would spend the budget loading or compressing the session while the agent's
// runner waits for its reflection before the next run. In practice: short runs, a failure
// after a few steps or a rework; a run of many tool calls reads far more and stays on its
// model. More time for the same turns, since a local model reads and writes slower.
export const LOCAL_REFLECTION_MAX_READ = 64_000;
export const LOCAL_REFLECTION_LIMITS = { maxTurns: 8, runBudgetSeconds: 240 };

// Why the run is worth a reflection, or null when it is not. A failed run with no tool
// call failed before the agent did anything, often at its provider, which a follow-up
// turn would meet again.
export function reflectionReason(
  policy: AgentRuntimePolicy,
  run: { status: 'success' | 'failed'; toolCalls: number; rework: boolean },
): ReflectionReason | null {
  const mode = policy.reflection ?? 'complex';
  if (policy.learning === false || mode === 'off') return null;
  if (run.status === 'failed') return run.toolCalls > 0 ? 'failure' : null;
  if (run.rework) return 'rework';
  return mode === 'complex' && run.toolCalls >= COMPLEX_TOOL_CALLS ? 'complex' : null;
}

const FOCUS: Record<ReflectionReason, string> = {
  failure:
    'The task failed. Keep only a lesson you are sure of: what caused the failure and what ' +
    'works instead. Do not write down attempts that did not work as a method.',
  rework:
    'You came back to work that needed another pass. Keep what the feedback taught you ' +
    'about how this work is wanted, so the first pass is right next time.',
  complex:
    'The task took many steps. Keep the procedure that worked, so the next task of this ' +
    'kind takes fewer.',
};

export function reflectionPrompt(reason: ReflectionReason): string {
  return [
    'Look back at the task you just finished in this session and keep what will help you ' +
      'next time. Only your memory and skill tools are available now: do not continue the ' +
      'task.',
    FOCUS[reason],
    'Memory has two stores. Save each fact once, in the right one:\n' +
      "- USER.md (memory tool, target 'user'): who you work for and how they want things done.\n" +
      "- MEMORY.md (memory tool, target 'memory'): facts about your environment, such as tool " +
      'quirks, project conventions, and paths and endpoints that matter.',
    'A skill says how to do a class of task well (skill_manage): the steps in order, the ' +
      'commands and tools that work, and each pitfall as a rule with its reason. Prefer, in ' +
      'this order: patch a skill you used in this session, extend an existing skill that ' +
      'covers the class, add a references/ file to one, create a skill named for the class ' +
      'of task, never for this one task. Read a skill with skill_view before you change it.',
    'Leave the skills in the plan-managed category alone: Helena manages them and puts back any ' +
      'change. Do not save details of this one task, secrets, missing tools or other setup ' +
      'problems, or anything you are not sure of.',
    'If nothing is worth keeping, answer "Nothing to save." Otherwise answer with one short ' +
      'line per thing you saved.',
  ].join('\n\n');
}

// The turn after a chat went quiet (docs/helena-decisions/agent-context.md §5): where the
// person says who they are and how they want things done, which a run rarely shows.
export function chatReflectionPrompt(): string {
  return [
    'Look back at the conversation in this session and keep what will help you in the next ' +
      'ones. Only your memory and skill tools are available now: do not answer the person ' +
      'and do not continue any task.',
    'Keep what the person told you or showed about themselves, their work and how they want ' +
      'things done: preferences, decisions, recurring wishes, corrections of what you did. ' +
      'Keep a fact about your environment only when the conversation settled it.',
    'Memory has two stores. Save each fact once, in the right one:\n' +
      "- USER.md (memory tool, target 'user'): who you work for and how they want things done.\n" +
      "- MEMORY.md (memory tool, target 'memory'): facts about your environment, such as tool " +
      'quirks, project conventions, and paths and endpoints that matter.',
    'Create or patch a skill (skill_manage) only when the conversation worked out how to do a ' +
      'class of task, step by step. Read a skill with skill_view before you change it.',
    'Leave the skills in the plan-managed category alone: Helena manages them. Do not save ' +
      'what your memory or instructions already hold, details of this one conversation, ' +
      'secrets, or anything you are not sure of.',
    'If nothing is worth keeping, answer "Nothing to save." Otherwise answer with one short ' +
      'line per thing you saved.',
  ].join('\n\n');
}

export interface ReflectionView {
  status: 'pending' | 'success' | 'failed' | 'lost';
  reason: ReflectionReason;
  // The local model it ran on, when Lokale KI took it; null on the run's model.
  model?: string | null;
  saved: { tool: 'memory' | 'skill'; action: string; target: string }[];
  summary: string | null;
  error: string | null;
  tokens?: number;
}

// A reflection that has not reported this long after its run ended never will: its
// runner stopped or lost the report.
const LOST_AFTER_MS = 15 * 60_000;

// The reflection of a run as its history shows it, or null for a run that had none.
export function reflectionView(value: unknown, finishedAt: Date | null): ReflectionView | null {
  if (!value || typeof value !== 'object') return null;
  const stored = value as Partial<ReflectionView> & {
    inputTokens?: number | null;
    outputTokens?: number | null;
  };
  const lost =
    stored.status === 'pending' &&
    finishedAt !== null &&
    Date.now() - finishedAt.getTime() > LOST_AFTER_MS;
  const counted = stored.inputTokens != null || stored.outputTokens != null;
  return {
    status: lost ? 'lost' : (stored.status ?? 'pending'),
    reason: stored.reason ?? 'complex',
    ...(stored.model && { model: stored.model }),
    saved: Array.isArray(stored.saved) ? stored.saved : [],
    summary: stored.summary ?? null,
    error: stored.error ?? null,
    ...(counted && { tokens: (stored.inputTokens ?? 0) + (stored.outputTokens ?? 0) }),
  };
}
