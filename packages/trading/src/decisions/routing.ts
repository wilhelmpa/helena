import type { DecisionEvalCase, DecisionEvalSet } from '@helena/sdk';
import { ROUTING_QUESTIONS } from './questions';

// Labelled cases of the task routing of the TRADE team (docs/helena-decisions/trading.md §6):
// a task as it arrives at the coordinator, and the role that should take it.

interface RoutingCase {
  id: string;
  task: string;
  role: string | string[];
}

const CASES: RoutingCase[] = [
  {
    id: 'news-scan',
    task: 'Was gab es heute an wichtigen Nachrichten zu den Werten auf der Watchlist? Kurz zusammenfassen.',
    role: 'research',
  },
  {
    id: 'valuation',
    task: 'Ist Nordwind Energie im Vergleich zu anderen Windkraft-Unternehmen günstig bewertet? Bitte KGV, EV/EBITDA und eine einfache DCF.',
    role: 'research',
  },
  {
    id: 'earnings-preview',
    task: 'Kalix meldet am Donnerstag Zahlen. Was erwartet der Markt, und worauf kommt es an?',
    role: 'research',
  },
  {
    id: 'levels',
    task: 'Zeichne Unterstützungen und Widerstände für SPY im Tageschart ein und beschreibe den Trend.',
    role: ['chart', 'daytrading'],
  },
  {
    id: 'regime',
    task: 'In welchem Marktregime sind wir gerade (Trend, Seitwärts, hohe Volatilität)? Bitte mit ATR und 200-Tage-Linie begründen.',
    role: 'chart',
  },
  {
    id: 'tokenomics',
    task: 'Wie sieht die Tokenomics von Solvra aus: Angebot, Freischaltungen, Inflation? Ist das ein Risiko?',
    role: 'crypto',
  },
  {
    id: 'onchain',
    task: 'Wie haben sich die Bitcoin-Börsenbestände und die Zuflüsse in Stablecoins in den letzten 30 Tagen entwickelt?',
    role: 'crypto',
  },
  {
    id: 'premarket',
    task: 'Pre-Market-Briefing für heute: Termine, Gaps auf der Watchlist, Levels und Plan für die US-Eröffnung.',
    role: 'daytrading',
  },
  {
    id: 'session-plan',
    task: 'Plane die heutige Session: welche zwei Setups beobachten wir zur Eröffnung, mit Einstieg, Stop und Ziel?',
    role: 'daytrading',
  },
  {
    id: 'position-size',
    task: 'Wie viele Aktien darf ich bei Einstieg 182 USD und Stop 176 USD kaufen, wenn das Risiko 1 % des Paper-Kontos sein soll?',
    role: 'risk',
  },
  {
    id: 'weekly-review',
    task: 'Wochenreview: Trefferquote, Erwartungswert, Drawdown und Regelverstöße der letzten Woche, verglichen mit dem Backtest.',
    role: 'risk',
  },
  {
    id: 'journal-gap',
    task: 'Im Journal fehlen zwei Trades von gestern. Bitte mit den Paper-Orders abgleichen und nachtragen.',
    role: ['risk', 'paper'],
  },
  {
    id: 'rulebook-change',
    task: 'Das Regelwerk soll eine Regel bekommen: nach zwei Verlusttrades in Folge Pause bis zum nächsten Tag. Bitte einarbeiten.',
    role: ['risk', 'strategy'],
  },
  {
    id: 'backtest',
    task: 'Backteste die Eröffnungsspannen-Strategie auf SPY von 2018 bis 2025 mit Kosten und Slippage, in- und out-of-sample.',
    role: 'quant',
  },
  {
    id: 'walk-forward',
    task: 'Mach einen Walk-Forward-Test für die Parameter der Momentum-Strategie und prüfe, ob die Ergebnisse stabil sind.',
    role: 'quant',
  },
  {
    id: 'data-quality',
    task: 'Die historischen Minutendaten für QQQ haben Lücken. Prüfe die Datenqualität und bereinige sie für den Backtest.',
    role: 'quant',
  },
  {
    id: 'new-idea',
    task: 'Idee: Nach starken Gap-Downs bei großen Tech-Aktien kommt oft eine Gegenbewegung. Formuliere daraus eine testbare Strategie mit klaren Regeln.',
    role: 'strategy',
  },
  {
    id: 'improve-version',
    task: 'Die Paper-Ergebnisse von orb-spy 1.2 liegen unter dem Backtest. Schlage eine verbesserte Version 1.3 vor.',
    role: 'strategy',
  },
  {
    id: 'retire',
    task: 'Die Mean-Reversion-Strategie verliert seit sechs Wochen. Sollen wir sie ausmustern? Bitte nach den Kriterien des Strategie-Labors prüfen.',
    role: ['strategy', 'risk'],
  },
  {
    id: 'place-paper-order',
    task: 'Setup von orb-spy 1.2 ist ausgelöst: Paper-Order für SPY mit Stop nach Regel platzieren.',
    role: 'paper',
  },
  {
    id: 'paper-report',
    task: 'Tagesbericht des Paper-Kontos: Positionen, Tages-P&L, ausgeführte Orders.',
    role: ['paper', 'risk'],
  },
  {
    id: 'tax-docs',
    task: 'Wie dokumentiere ich die Krypto-Verkäufe dieses Jahres für die Steuer (Haltefrist, FIFO)?',
    role: 'finance',
  },
  {
    id: 'plan-quarter',
    task: 'Plane die nächsten vier Wochen im Trading-Projekt: welche Aufgaben, wer macht was, was muss ich entscheiden?',
    role: 'coordinator',
  },
  {
    id: 'unclear',
    task: 'Kannst du dich mal um das Trading kümmern?',
    role: 'coordinator',
  },
];

export const ROUTING_CASES: DecisionEvalCase[] = CASES.map((entry) => ({
  id: entry.id,
  context: `Aufgabe im Trading-Projekt: ${entry.task}`,
  questions: { ...ROUTING_QUESTIONS },
  expected: { role: entry.role },
}));

export const ROUTING_EVAL: DecisionEvalSet = {
  cases: ROUTING_CASES,
  minPrecision: 0.85,
  minCoverage: 0.5,
};
