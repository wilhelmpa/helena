import {
  PAPER_PRECHECK_QUESTIONS,
  TRADING_PRECHECK_CLASS,
  type PaperExecution,
} from '@helena/trading';
import { decide } from '#modules/decisions/service';
import { strategySnapshot } from './strategies';
import { queuePaperReview } from './precheck-review';

export const precheckPaperOrder: PaperExecution['precheck'] = async (ctx, input) => {
  if (!ctx.project?.teamId) return { allowed: false, reason: 'Paper precheck requires a project.' };
  let rule: string | null = null;
  if (input.strategyId && input.strategyVersion) {
    rule = (
      await strategySnapshot(ctx.project, {
        strategyId: input.strategyId,
        strategyVersion: input.strategyVersion,
      })
    ).content;
  } else if (input.order.side === 'sell') {
    rule =
      'Reduce an existing long position without selling more than is held; the hard checks must pass.';
  }
  const result = await decide({
    teamId: ctx.project.teamId,
    projectId: ctx.project.id,
    agentId: ctx.agent?.id,
    runId: ctx.runId,
    classId: TRADING_PRECHECK_CLASS,
    subject: `paper-precheck:${input.requestId}`,
    localOnly: true,
    allowPrivateJev: true,
    context: {
      symbol: input.order.symbol,
      side: input.order.side,
      rules: { rule, rationale: input.rationale },
      risk: {
        allowed: input.check.ok,
        violations: input.check.violations,
        marketOpen: input.marketOpen,
        cryptoEntry: input.order.side === 'buy' && input.check.assetClass === 'crypto',
      },
      news: input.newsContext ?? null,
      unique: { duplicate: input.duplicate },
    },
    questions: PAPER_PRECHECK_QUESTIONS,
    signal: ctx.signal,
  }).catch(() => null);
  const failed = Object.keys(PAPER_PRECHECK_QUESTIONS).filter((key) => {
    const answer = result?.answers[key];
    return !answer?.decided || answer.choice !== 'yes';
  });
  const allowed =
    failed.length === 0 &&
    ['typesafe', 'vercel'].includes(result?.backend ?? '') &&
    input.check.ok &&
    input.marketOpen &&
    !input.duplicate;
  const reason = allowed
    ? 'Paper precheck passed.'
    : `Trading coordinator review required: ${failed.join(', ') || 'server checks'}. No order was placed.`;
  const reviewId = allowed ? null : await queuePaperReview(ctx, input.requestId, reason);
  return {
    allowed,
    reason: reviewId ? `${reason} Review task: ${reviewId}.` : reason,
  };
};
