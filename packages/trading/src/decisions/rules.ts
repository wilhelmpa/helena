import type { DecisionEvalCase, DecisionEvalSet } from '@helena/sdk';
import { ruleQuestion } from './questions';

// Labelled cases of the rule check (docs/helena-decisions/trading.md §6): a planned paper
// trade as the Paper-Trader or the day-trading preparation writes it down, one rule of the
// rule book, and whether the plan meets it. The class answers a checklist item quickly; the
// hard limits (order value, position value, risk to the stop, daily loss) are enforced by
// Helena's paper tools regardless of any answer here. Symbols and numbers are invented.

interface RuleCase {
  id: string;
  plan: string;
  rule: string;
  meets: 'yes' | 'no';
}

const CASES: RuleCase[] = [
  {
    id: 'stop-set',
    plan: 'Kauf 20 SPY zu 612,40 USD, Stop 608,90 USD, Ziel 619,00 USD.',
    rule: 'Jeder Trade hat vor dem Einstieg einen festen Stop.',
    meets: 'yes',
  },
  {
    id: 'stop-missing',
    plan: 'Kauf 15 KLX zu 182,10 USD, Ausstieg „nach Gefühl“, kein Stop festgelegt.',
    rule: 'Jeder Trade hat vor dem Einstieg einen festen Stop.',
    meets: 'no',
  },
  {
    id: 'rr-two-met',
    plan: 'Einstieg 100,00 USD, Stop 98,00 USD, Ziel 104,00 USD.',
    rule: 'Das Chance-Risiko-Verhältnis (Ziel minus Einstieg geteilt durch Einstieg minus Stop) ist mindestens 2.',
    meets: 'yes',
  },
  {
    id: 'rr-two-missed',
    plan: 'Einstieg 50,00 USD, Stop 48,00 USD, Ziel 52,50 USD.',
    rule: 'Das Chance-Risiko-Verhältnis (Ziel minus Einstieg geteilt durch Einstieg minus Stop) ist mindestens 2.',
    meets: 'no',
  },
  {
    id: 'earnings-soon',
    plan: 'Swing-Kauf KLX heute, Haltedauer 5 Tage. KLX meldet übermorgen Quartalszahlen.',
    rule: 'Keine neue Position, wenn das Unternehmen in den nächsten 3 Handelstagen Zahlen meldet.',
    meets: 'no',
  },
  {
    id: 'earnings-far',
    plan: 'Swing-Kauf NWE heute, Haltedauer 3 Tage. Nächste Zahlen von NWE in fünf Wochen.',
    rule: 'Keine neue Position, wenn das Unternehmen in den nächsten 3 Handelstagen Zahlen meldet.',
    meets: 'yes',
  },
  {
    id: 'risk-one-percent-met',
    plan: 'Paper-Konto 10.000 USD. Kauf 40 Stück zu 25,00 USD, Stop 23,00 USD (Risiko 80 USD).',
    rule: 'Das Risiko bis zum Stop beträgt höchstens 1 % des Kontos.',
    meets: 'yes',
  },
  {
    id: 'risk-one-percent-broken',
    plan: 'Paper-Konto 10.000 USD. Kauf 100 Stück zu 30,00 USD, Stop 28,00 USD (Risiko 200 USD).',
    rule: 'Das Risiko bis zum Stop beträgt höchstens 1 % des Kontos.',
    meets: 'no',
  },
  {
    id: 'opening-minutes',
    plan: 'US-Daytrade: Einstieg geplant um 15:32 Uhr MEZ, direkt nach Handelsbeginn in New York (15:30 Uhr MEZ).',
    rule: 'Kein Einstieg in den ersten 5 Minuten nach Handelsbeginn.',
    meets: 'no',
  },
  {
    id: 'after-opening-range',
    plan: 'US-Daytrade: Einstieg erst nach dem Ausbruch aus der 15-Minuten-Eröffnungsspanne, frühestens 15:45 Uhr MEZ.',
    rule: 'Kein Einstieg in den ersten 5 Minuten nach Handelsbeginn.',
    meets: 'yes',
  },
  {
    id: 'trend-long-ok',
    plan: 'Long SPY. SPY notiert bei 612 USD, der 50-Tage-Durchschnitt liegt bei 596 USD und steigt.',
    rule: 'Long-Trades nur, wenn der Kurs über dem steigenden 50-Tage-Durchschnitt liegt.',
    meets: 'yes',
  },
  {
    id: 'trend-long-against',
    plan: 'Long NWE. NWE notiert bei 18,40 EUR, der 50-Tage-Durchschnitt liegt bei 21,10 EUR und fällt.',
    rule: 'Long-Trades nur, wenn der Kurs über dem steigenden 50-Tage-Durchschnitt liegt.',
    meets: 'no',
  },
  {
    id: 'max-trades-reached',
    plan: 'Heute bereits drei abgeschlossene Trades (zwei Verluste, ein Gewinn). Geplant ist ein vierter Einstieg in QQQ.',
    rule: 'Höchstens drei Trades pro Tag.',
    meets: 'no',
  },
  {
    id: 'max-trades-ok',
    plan: 'Heute ein abgeschlossener Trade. Geplant ist der zweite Einstieg in SPY.',
    rule: 'Höchstens drei Trades pro Tag.',
    meets: 'yes',
  },
  {
    id: 'fomc-soon',
    plan: 'Einstieg in SPY um 19:30 Uhr MEZ geplant. Die Fed-Zinsentscheidung wird um 20:00 Uhr MEZ veröffentlicht.',
    rule: 'Kein neuer Einstieg in den 60 Minuten vor wichtigen Terminen (Fed, EZB, US-Arbeitsmarkt, US-Inflation).',
    meets: 'no',
  },
  {
    id: 'no-event-today',
    plan: 'Einstieg in QQQ um 16:15 Uhr MEZ. Heute stehen keine wichtigen Termine im Wirtschaftskalender.',
    rule: 'Kein neuer Einstieg in den 60 Minuten vor wichtigen Terminen (Fed, EZB, US-Arbeitsmarkt, US-Inflation).',
    meets: 'yes',
  },
  {
    id: 'after-daily-loss',
    plan: 'Tagesergebnis bisher −160 USD, Tagesverlustgrenze 150 USD. Geplant ist ein weiterer Einstieg, „um den Verlust aufzuholen“.',
    rule: 'Nach Erreichen der Tagesverlustgrenze keine neuen Trades an diesem Tag.',
    meets: 'no',
  },
  {
    id: 'under-daily-loss',
    plan: 'Tagesergebnis bisher −40 USD, Tagesverlustgrenze 150 USD. Geplant ist ein Einstieg nach Plan.',
    rule: 'Nach Erreichen der Tagesverlustgrenze keine neuen Trades an diesem Tag.',
    meets: 'yes',
  },
  {
    id: 'no-averaging-down',
    plan: 'Position KLX liegt 6 % im Minus. Geplant: noch einmal dieselbe Stückzahl nachkaufen, um den Einstandskurs zu senken.',
    rule: 'Keine Verlustpositionen verbilligen (kein Nachkaufen im Minus).',
    meets: 'no',
  },
  {
    id: 'adding-to-winner',
    plan: 'Position SPY liegt 3 % im Plus und über dem letzten Hoch; geplant ist ein Aufstocken um die Hälfte mit nachgezogenem Stop.',
    rule: 'Keine Verlustpositionen verbilligen (kein Nachkaufen im Minus).',
    meets: 'yes',
  },
  {
    id: 'approved-version',
    plan: 'Trade nach Strategie orb-spy Version 1.2; Version 1.2 hat der Owner am 12.10. für Paper-Trading freigegeben.',
    rule: 'Nur Strategie-Versionen handeln, die der Owner für Paper-Trading freigegeben hat.',
    meets: 'yes',
  },
  {
    id: 'unapproved-version',
    plan: 'Trade nach Strategie orb-spy Version 1.3 (Entwurf, Backtest läuft noch, keine Freigabe).',
    rule: 'Nur Strategie-Versionen handeln, die der Owner für Paper-Trading freigegeben hat.',
    meets: 'no',
  },
  {
    id: 'liquid-enough',
    plan: 'Kauf von 30 Aktien KLX; durchschnittliches Tagesvolumen 42 Mio. Stück, Spread 0,01 USD.',
    rule: 'Nur Werte mit mindestens 1 Mio. Stück durchschnittlichem Tagesvolumen handeln.',
    meets: 'yes',
  },
  {
    id: 'illiquid',
    plan: 'Kauf von 500 Aktien eines Nebenwerts; durchschnittliches Tagesvolumen 80.000 Stück, Spread 1,2 %.',
    rule: 'Nur Werte mit mindestens 1 Mio. Stück durchschnittlichem Tagesvolumen handeln.',
    meets: 'no',
  },
];

export const RULE_CASES: DecisionEvalCase[] = CASES.map((entry) => ({
  id: entry.id,
  context: `Geplanter Paper-Trade: ${entry.plan}`,
  questions: { meets: ruleQuestion(entry.rule) },
  expected: { meets: entry.meets },
}));

export const RULE_EVAL: DecisionEvalSet = {
  cases: RULE_CASES,
  minPrecision: 0.9,
  minCoverage: 0.5,
};
