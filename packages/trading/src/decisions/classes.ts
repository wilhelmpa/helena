import type { DecisionClass, DecisionQuestion } from '@helena/sdk';
import { NEWS_EVAL } from './news';
import { NEWS_QUESTIONS, ROUTING_QUESTIONS, ruleQuestion } from './questions';
import { RULE_EVAL } from './rules';
import { ROUTING_EVAL } from './routing';

// The trading decision classes (docs/helena-decisions/trading.md §6), registered by the
// internal plugin helena.trading at the framework's `decisionClasses` point. Like every
// class they are off until the owner switches them on in Home → Entscheidungen, which
// Helena allows only once the class's eval passed on the chosen connection.
//
// They are for fast sorting, never for entry or exit signals: which news matter, whether a
// planned trade meets one written rule (a checklist item; the hard limits are enforced by
// the paper tools themselves), which role of the team takes a task.

export const TRADING_NEWS_CLASS = 'helena.trading.news';
export const TRADING_RULES_CLASS = 'helena.trading.rules';
export const TRADING_ROUTING_CLASS = 'helena.trading.routing';

export const TRADING_DECISION_CLASSES: DecisionClass[] = [
  {
    id: TRADING_NEWS_CLASS,
    label: { en: 'Trading: sort news', de: 'Trading: Nachrichten einordnen' },
    description: {
      en: 'Relevance for named instruments, likely direction and kind of event of a news item. Sorting only, no trading signal. Only explicitly shared public news may use cloud; freeform context stays local.',
      de: 'Relevanz für benannte Instrumente, wahrscheinliche Richtung und Art des Ereignisses einer Meldung. Nur zum Sortieren, kein Handelssignal. Nur ausdrücklich freigegebene öffentliche Nachrichten dürfen in die Cloud; freier Kontext bleibt lokal.',
    },
    // Only explicitly declared public article/instrument payloads may use cloud.
    // The API restricts every legacy/freeform request to local attempts.
    input: { store: 'optional', cloud: 'allowed' },
    defaults: { threshold: 0.7, timeoutMs: 8000 },
    eval: NEWS_EVAL,
  },
  {
    id: TRADING_RULES_CLASS,
    label: { en: 'Trading: check a rule', de: 'Trading: Regel prüfen' },
    description: {
      en: 'Whether a planned paper trade meets one written rule of the rule book. A checklist aid; the hard limits are enforced by the paper tools.',
      de: 'Ob ein geplanter Paper-Trade eine Regel des Regelwerks erfüllt. Eine Checklisten-Hilfe; die harten Grenzen setzen die Paper-Werkzeuge selbst durch.',
    },
    // Plans and positions are the owner's: local backends only.
    input: { store: 'optional', cloud: 'never' },
    defaults: { threshold: 0.85, timeoutMs: 6000 },
    eval: RULE_EVAL,
  },
  {
    id: TRADING_ROUTING_CLASS,
    label: { en: 'Trading: route a task', de: 'Trading: Aufgabe zuordnen' },
    description: {
      en: 'Which role of the trading team takes a task (research, chart, crypto, day trading, risk, quant, strategy, paper, finance, coordination).',
      de: 'Welche Rolle des Trading-Teams eine Aufgabe übernimmt (Research, Chart, Krypto, Daytrading, Risiko, Quant, Strategie, Paper, Finanzen, Koordination).',
    },
    input: { store: 'optional', cloud: 'never' },
    defaults: { threshold: 0.7, timeoutMs: 5000 },
    eval: ROUTING_EVAL,
  },
];

export type TradingDecisionKind = 'news' | 'rule' | 'routing';

// The class and the questions for one kind of trading decision.
export function tradingQuestions(
  kind: TradingDecisionKind,
  rule?: string,
): { classId: string; questions: Record<string, DecisionQuestion> } {
  switch (kind) {
    case 'news':
      return { classId: TRADING_NEWS_CLASS, questions: { ...NEWS_QUESTIONS } };
    case 'rule':
      if (!rule?.trim()) throw new Error('A rule check needs the rule.');
      return { classId: TRADING_RULES_CLASS, questions: { meets: ruleQuestion(rule) } };
    case 'routing':
      return { classId: TRADING_ROUTING_CLASS, questions: { ...ROUTING_QUESTIONS } };
  }
}
