import { ROUTER_CLASS } from '#modules/decisions/classes';
import { getDisplayName } from '@repo/db';
import { ROUTER_TIERS, routerQuestions, type RouterTier } from '#modules/decisions/questions';
import { classSetting, decide } from '#modules/decisions/service';
import { routerConfig } from './service';
import { namedTier, tierRank } from './tiers';

// The owner's own Claude Code asks here before each prompt (the UserPromptSubmit hook in
// deployment/volition-stack/native/claude-code-router/, docs/helena-decisions/decisions.md
// §4.3): the same class "Modellwahl" rates the prompt, and when a cheaper Claude tier covers it
// and it stands on its own, the answer suggests handing it to a subagent of that tier. Only the
// prompt text comes here; nothing else of the session. Advice only: the hook adds a factual
// note, Claude decides, and any failure means no note.

const CLAUDE_ALIASES: Record<RouterTier, string> = {
  light: 'haiku',
  standard: 'sonnet',
  strong: 'opus',
  strongest: 'fable',
};

export interface PromptRoute {
  // delegate: a cheaper tier suffices; handle: the session model stays; none: no decision.
  decision: 'delegate' | 'handle' | 'none';
  status: string;
  tier: RouterTier | null;
  model: string | null;
  sessionModel: string;
  confidence: number | null;
  needsContext: number | null;
  latencyMs: number | null;
  // The text the hook adds to Claude's context (additionalContext), or '' for none.
  note: string;
  decisionId: number | null;
}

function pct(value: number | null): string {
  return value === null ? '–' : value.toFixed(2);
}

export async function routePrompt(input: {
  teamId: number;
  prompt: string;
  sessionModel: string;
  sessionId?: string | null;
}): Promise<PromptRoute> {
  const sessionTier = namedTier(input.sessionModel) ?? 'strong';
  const sessionModel = CLAUDE_ALIASES[sessionTier];
  const none: PromptRoute = {
    decision: 'none',
    status: 'off',
    tier: null,
    model: null,
    sessionModel,
    confidence: null,
    needsContext: null,
    latencyMs: null,
    note: '',
    decisionId: null,
  };
  const prompt = input.prompt.trim();
  if (prompt.length < 12 || prompt.startsWith('/')) return { ...none, status: 'skipped' };
  const outcome = await decide({
    teamId: input.teamId,
    classId: ROUTER_CLASS,
    context: `A request to a coding agent (Claude Code):\n${prompt.slice(0, 12_000)}`,
    questions: routerQuestions(),
    subject: `claude-code:${(input.sessionId ?? 'session').slice(0, 80)}`,
  });
  const route = outcome.answers.route;
  const needs = outcome.answers.needs_context;
  if (!route?.choice || !needs?.choice) return { ...none, status: outcome.status };
  if (!ROUTER_TIERS.includes(route.choice as RouterTier)) return { ...none, status: 'unsure' };
  const tier = route.choice as RouterTier;
  const needsContext = needs.probabilities?.yes ?? null;
  const { contextThreshold } = routerConfig(
    (await classSetting(input.teamId, ROUTER_CLASS)).config,
  );
  const cheaper = tierRank(tier) < tierRank(sessionTier);
  const delegate =
    route.decided &&
    needs.decided &&
    ['light', 'standard'].includes(tier) &&
    cheaper &&
    needsContext !== null &&
    needsContext < contextThreshold;
  const model = CLAUDE_ALIASES[ROUTER_TIERS.includes(tier) ? tier : sessionTier];
  // Factual, not imperative (Claude Code's hook guidance): the standing rule for what to do
  // with it lives in the owner's CLAUDE.md, which the installer offers to add.
  const displayName = await getDisplayName();
  const note = delegate
    ? `${displayName} model router: this request looks like ${tier} work (confidence ${pct(route.confidence)}) ` +
      `and does not depend on the earlier conversation (${pct(needsContext)}). ` +
      `A subagent with model "${model}" is expected to handle it well; the session model is ${sessionModel}.`
    : `${displayName} model router: ${sessionModel} stays for this request ` +
      `(rated ${tier}, confidence ${pct(route.confidence)}, depends on context ${pct(needsContext)}).`;
  return {
    decision: delegate ? 'delegate' : 'handle',
    status: outcome.status,
    tier,
    model: delegate ? model : sessionModel,
    sessionModel,
    confidence: route.confidence,
    needsContext,
    latencyMs: outcome.latencyMs,
    note,
    decisionId: route.decisionId,
  };
}
