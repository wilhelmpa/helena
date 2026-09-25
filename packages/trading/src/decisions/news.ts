import type { DecisionEvalCase, DecisionEvalSet } from '@helena/sdk';
import { NEWS_QUESTIONS } from './questions';

// Labelled cases of the news class (docs/helena-decisions/trading.md §6): a watchlist, the
// open positions and one news item, as the research agent passes them, with the right
// answer per question (several where more than one is defensible). Companies, tickers,
// people and numbers are invented; central banks and indices are real names.

const WATCHLIST =
  'Watchlist: NWE (Nordwind Energie AG, Windkraft, XETRA), KLX (Kalix Semiconductor, Chips, NASDAQ), SPY (S&P-500-ETF), BTC/USD\nOffene Positionen: KLX, BTC/USD';

interface NewsCase {
  id: string;
  news: string;
  relevance: string | string[];
  direction: string | string[];
  event: string | string[];
}

const CASES: NewsCase[] = [
  {
    id: 'klx-guidance-raise',
    news: 'Kalix Semiconductor hebt Jahresprognose an: Umsatz nun 14,2 statt 13,1 Mrd. USD erwartet, Rechenzentrumsnachfrage stärker als geplant.',
    relevance: 'high',
    direction: 'positive',
    event: 'earnings',
  },
  {
    id: 'klx-cfo-resigns',
    news: 'Kalix Semiconductor: Finanzvorständin tritt mit sofortiger Wirkung zurück, Gründe nennt das Unternehmen nicht. Nachfolge offen.',
    relevance: 'high',
    direction: 'negative',
    event: 'corporate',
  },
  {
    id: 'nwe-results-in-line',
    news: 'Nordwind Energie legt Q3-Zahlen vor: Umsatz und EBITDA genau im Rahmen der Analystenerwartungen, Prognose bestätigt.',
    relevance: ['high', 'medium'],
    direction: 'neutral',
    event: 'earnings',
  },
  {
    id: 'fed-surprise-hike',
    news: 'Die Fed erhöht den Leitzins überraschend um 50 Basispunkte; Märkte hatten mit einer Pause gerechnet. Powell schließt weitere Schritte nicht aus.',
    relevance: ['high', 'medium'],
    direction: 'negative',
    event: 'macro',
  },
  {
    id: 'ifo-slightly-better',
    news: 'Ifo-Geschäftsklima steigt im Oktober leicht auf 86,4 Punkte (Prognose 86,1).',
    relevance: ['low', 'medium'],
    direction: 'positive',
    event: 'macro',
  },
  {
    id: 'btc-etf-inflows',
    news: 'US-Bitcoin-ETFs verzeichnen mit 1,9 Mrd. USD den höchsten Wochenzufluss seit ihrer Zulassung.',
    relevance: 'high',
    direction: 'positive',
    event: ['crypto', 'other'],
  },
  {
    id: 'exchange-hack',
    news: 'Kryptobörse Korvex meldet Hack: Angreifer erbeuten Token im Wert von rund 200 Mio. USD, Auszahlungen vorerst gestoppt.',
    relevance: ['medium', 'high'],
    direction: 'negative',
    event: 'crypto',
  },
  {
    id: 'eth-upgrade-on-schedule',
    news: 'Ethereum-Entwickler bestätigen: Das nächste Netzwerk-Upgrade kommt wie geplant im Dezember.',
    relevance: ['low', 'none'],
    direction: ['positive', 'neutral'],
    event: 'crypto',
  },
  {
    id: 'klx-eu-antitrust',
    news: 'EU-Kommission leitet Kartellverfahren gegen Kalix Semiconductor ein: Verdacht auf Missbrauch einer marktbeherrschenden Stellung bei KI-Beschleunigern.',
    relevance: 'high',
    direction: 'negative',
    event: 'regulation',
  },
  {
    id: 'nwe-offshore-contract',
    news: 'Nordwind Energie gewinnt Auftrag über 1,2 Mrd. EUR für einen Offshore-Windpark in der Ostsee.',
    relevance: 'high',
    direction: 'positive',
    event: 'corporate',
  },
  {
    id: 'football-transfer',
    news: 'Bundesliga: Stürmer wechselt für 45 Mio. EUR nach England.',
    relevance: 'none',
    direction: 'neutral',
    event: 'other',
  },
  {
    id: 'peer-profit-warning',
    news: 'Tessaro Semiconductors (nicht auf der Watchlist) senkt Gewinnprognose wegen schwacher Nachfrage nach PC-Chips.',
    relevance: ['medium', 'low'],
    direction: 'negative',
    event: 'earnings',
  },
  {
    id: 'us-cpi-hot',
    news: 'US-Inflation im September bei 3,6 % (erwartet 3,2 %); Kernrate ebenfalls höher als prognostiziert.',
    relevance: ['high', 'medium'],
    direction: 'negative',
    event: 'macro',
  },
  {
    id: 'klx-buyback',
    news: 'Kalix Semiconductor kündigt Aktienrückkauf über 5 Mrd. USD an und erhöht die Quartalsdividende um 10 %.',
    relevance: 'high',
    direction: 'positive',
    event: 'corporate',
  },
  {
    id: 'nwe-permit-annulled',
    news: 'Oberverwaltungsgericht kippt die Genehmigung für den größten Onshore-Windpark von Nordwind Energie; das Projekt ruht.',
    relevance: 'high',
    direction: 'negative',
    event: 'regulation',
  },
  {
    id: 'token-unlock-unrelated',
    news: 'Solvra (SLV): Nächste Woche werden 15 % des Token-Angebots aus der Sperrfrist frei.',
    relevance: ['none', 'low'],
    direction: 'negative',
    event: 'crypto',
  },
  {
    id: 'ecb-hold-expected',
    news: 'EZB lässt die Leitzinsen wie erwartet unverändert und bekräftigt ihren datenabhängigen Kurs.',
    relevance: ['low', 'medium'],
    direction: 'neutral',
    event: 'macro',
  },
  {
    id: 'klx-mixed-quarter',
    news: 'Kalix Semiconductor Q2: Umsatz übertrifft Erwartungen, Bruttomarge aber deutlich darunter; Ausblick für Q3 gesenkt.',
    relevance: 'high',
    direction: ['mixed', 'negative'],
    event: 'earnings',
  },
  {
    id: 'sp500-record',
    news: 'Marktbericht: Der S&P 500 schließt erstmals über 7.000 Punkten, getragen von Technologiewerten.',
    relevance: ['medium', 'high'],
    direction: 'positive',
    event: ['other', 'macro'],
  },
  {
    id: 'unrelated-pharma-lawsuit',
    news: 'Sammelklage gegen den Pharmahersteller Vireon Bio wegen verschwiegener Studiendaten eingereicht.',
    relevance: 'none',
    direction: 'negative',
    event: 'regulation',
  },
  {
    id: 'nwe-insider-buy',
    news: 'Directors Dealings: Der CEO von Nordwind Energie kauft Aktien für 2,1 Mio. EUR.',
    relevance: ['high', 'medium'],
    direction: 'positive',
    event: 'corporate',
  },
  {
    id: 'crypto-custody-rules',
    news: 'US-Börsenaufsicht erlaubt Banken künftig die Verwahrung von Bitcoin für Kunden; neue Regeln treten im Januar in Kraft.',
    relevance: ['medium', 'high'],
    direction: 'positive',
    event: ['regulation', 'crypto'],
  },
  {
    id: 'klx-chip-delay',
    news: 'Kalix Semiconductor verschiebt den Marktstart seines neuen KI-Chips um sechs Monate wegen Fertigungsproblemen.',
    relevance: 'high',
    direction: 'negative',
    event: 'corporate',
  },
  {
    id: 'us-holiday',
    news: 'Hinweis: Die US-Börsen bleiben am Montag wegen Labor Day geschlossen.',
    relevance: ['low', 'medium'],
    direction: 'neutral',
    event: 'other',
  },
];

export const NEWS_CASES: DecisionEvalCase[] = CASES.map((entry) => ({
  id: entry.id,
  context: `${WATCHLIST}\nMeldung: ${entry.news}`,
  questions: { ...NEWS_QUESTIONS },
  expected: { relevance: entry.relevance, direction: entry.direction, event: entry.event },
}));

export const NEWS_EVAL: DecisionEvalSet = {
  cases: NEWS_CASES,
  minPrecision: 0.85,
  minCoverage: 0.5,
};
