import type { DecisionQuestion } from '@helena/sdk';

// The questions of the trading decision classes (docs/helena-decisions/trading.md §6). They
// are for fast sorting only — which news matter, whether a written rule is met, who takes a
// task — never for entry or exit signals. Questions and options are in English like
// Helena's own; the contexts are German like the owner's notes.

export const NEWS_RELEVANCE: DecisionQuestion = {
  kind: 'choice',
  question:
    'How relevant is this news item for the watchlist and the open positions named in the context?',
  options: [
    {
      id: 'high',
      label:
        'High: directly about a named instrument (or the one driver it depends on) and likely to move it noticeably.',
    },
    {
      id: 'medium',
      label:
        'Medium: about a named instrument but minor, or market-wide news that moves everything a little.',
    },
    { id: 'low', label: 'Low: related sector or theme, unlikely to move a named instrument.' },
    { id: 'none', label: 'None: unrelated to the watchlist and the positions.' },
  ],
};

export const NEWS_DIRECTION: DecisionQuestion = {
  kind: 'choice',
  question: 'What is the likely direction of this news for the instrument it is mainly about?',
  options: [
    { id: 'positive', label: 'Positive: better than expected, supportive for the price.' },
    { id: 'negative', label: 'Negative: worse than expected, a burden for the price.' },
    { id: 'neutral', label: 'Neutral: as expected or without a clear effect.' },
    { id: 'mixed', label: 'Mixed: clearly positive and clearly negative parts.' },
  ],
};

export const NEWS_EVENT: DecisionQuestion = {
  kind: 'choice',
  question: 'What kind of event is this news item about?',
  options: [
    { id: 'earnings', label: 'Earnings: quarterly or annual results, guidance, profit warnings.' },
    {
      id: 'macro',
      label: 'Macro: economic data, inflation, jobs, central bank decisions and speeches.',
    },
    {
      id: 'regulation',
      label: 'Regulation: laws, regulators, approvals, lawsuits, investigations, sanctions.',
    },
    {
      id: 'corporate',
      label:
        'Corporate: mergers, acquisitions, management changes, buybacks, dividends, products, contracts.',
    },
    {
      id: 'crypto',
      label: 'Crypto: protocol upgrades, token unlocks, exchange or custody events, hacks.',
    },
    { id: 'other', label: 'Something else.' },
  ],
};

export const NEWS_QUESTIONS = {
  relevance: NEWS_RELEVANCE,
  direction: NEWS_DIRECTION,
  event: NEWS_EVENT,
} as const;

// A written rule of the rule book, checked against a planned trade. The rule is part of the
// question, so each rule is its own question.
export function ruleQuestion(rule: string): DecisionQuestion {
  return {
    kind: 'yesno',
    question: `Does the planned trade described in the context satisfy this rule? Rule: ${rule.trim().slice(0, 1500)}`,
  };
}

// The roles of the TRADE team (blueprints/trading), for routing a task.
export const ROUTING: DecisionQuestion = {
  kind: 'choice',
  question: 'Which role of the trading team should take this task?',
  options: [
    {
      id: 'research',
      label:
        'Market research: news, company fundamentals, valuation, earnings, macro and the economic calendar.',
    },
    {
      id: 'chart',
      label: 'Chart analysis: trend, support and resistance, indicators, volatility, market regime.',
    },
    {
      id: 'crypto',
      label: 'Crypto analysis: tokens, tokenomics, on-chain data, crypto market structure.',
    },
    {
      id: 'daytrading',
      label: 'Day-trading preparation: pre-market brief, watchlist, levels and plan for the session.',
    },
    {
      id: 'risk',
      label:
        'Risk and journal: rule book, position sizing, trade journal, daily report, weekly and monthly reviews.',
    },
    {
      id: 'quant',
      label: 'Backtesting and quant: historical data, backtests, statistics, walk-forward tests.',
    },
    {
      id: 'strategy',
      label:
        'Strategy development: ideas and hypotheses, strategy rules, new versions, retiring strategies.',
    },
    {
      id: 'paper',
      label: 'Paper trading: placing or cancelling paper orders, the paper account and its positions.',
    },
    {
      id: 'finance',
      label: 'Finance and taxes: documenting capital gains, crypto holding periods, tax records.',
    },
    {
      id: 'coordinator',
      label: 'Coordination: planning across roles, unclear requests, questions for the owner.',
    },
  ],
};

export const ROUTING_QUESTIONS = { role: ROUTING } as const;
