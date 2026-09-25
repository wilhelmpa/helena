import type { DecisionEvalCase, DecisionEvalSet } from '@helena/sdk';

import { routerQuestions, type RouterTier } from '../questions';

// Labelled cases of the model router (docs/helena-decisions/decisions.md §4): one message a
// person sends to an agent (a coding agent in a monorepo, or an assistant for mail, calendar,
// research and the shop), the cheapest tier that handles it well, and whether it depends on
// the earlier conversation. Where two neighbouring tiers are both defensible, both count.
// People, companies and numbers are invented.

type RouterCase = [
  id: string,
  route: RouterTier | RouterTier[],
  needsContext: boolean,
  message: string,
];

const CASES: RouterCase[] = [
  // ── light ──────────────────────────────────────────────────────────────────────────────
  [
    'light-find-function',
    'light',
    false,
    'Wo im Repo wird die Sortierung der Kanban-Spalten festgelegt? Ich brauche nur den Dateipfad und den Namen der Funktion.',
  ],
  ['light-how-many-of-those', 'light', true, 'Und wie viele davon sind mir zugewiesen?'],
  [
    'light-typo-en',
    'light',
    false,
    'Fix the typo in apps/web/messages/de.json: the key settings.title reads "Einstellungnen", it should be "Einstellungen". Nothing else.',
  ],
  [
    'light-summarize-mail',
    'light',
    false,
    'Fass mir die letzte Mail von Kerstin Albrecht (Kessler Logistik) in zwei Sätzen zusammen.',
  ],
  ['light-calendar-tomorrow', 'light', false, 'Was steht morgen Vormittag in meinem Kalender?'],
  [
    'light-confirm-rename',
    'light',
    true,
    'Ja, bitte so – nenn die Variable wie vorgeschlagen `retryCount`, sonst nichts ändern.',
  ],
  [
    'light-earlier-file',
    'light',
    true,
    'Was stand nochmal in der zweiten Datei, die du vorhin geöffnet hast? Nur kurz die Eckpunkte.',
  ],
  [
    'light-list-env-en',
    'light',
    false,
    'List every environment variable the API reads at startup, with the file where each one is read. Do not change anything.',
  ],
  [
    'light-set-status',
    'light',
    false,
    'Setz das Ticket VERVE-88 auf „Erledigt“ und häng den Kommentar „im Release 1.12 behoben“ an.',
  ],
  [
    'light-same-for-translations',
    ['light', 'standard'],
    true,
    'Mach das gleiche noch für die englische und die französische Übersetzung.',
  ],

  // ── standard ───────────────────────────────────────────────────────────────────────────
  [
    'standard-unit-tests',
    'standard',
    false,
    'Schreib Unit-Tests für `formatCurrency` in packages/utils/src/money.ts: Beträge mit Nachkommastellen, negative Beträge, 0, sehr große Zahlen und undefined. Die Funktion selbst bitte nicht ändern.',
  ],
  [
    'standard-reply-draft',
    'standard',
    false,
    'Entwirf eine freundliche Antwort an Frau Kessler von der Bäckerei Sonnenkorn: Wir können den Workshop vom 14. auf den 21. Oktober verschieben, gleiche Uhrzeit, gleicher Raum. Nicht senden, nur als Entwurf ablegen.',
  ],
  [
    'standard-tests-for-that',
    'standard',
    true,
    'Gut. Und jetzt noch die Tests dafür, bitte auch für den Fehlerfall.',
  ],
  [
    'standard-column-en',
    'standard',
    false,
    'Add a sortable "Due date" column to the task table view. The API already returns `dueDate`; reuse the existing DateCell component and add the column to the column picker.',
  ],
  [
    'standard-rename-refactor',
    'standard',
    false,
    'Benenne im ganzen Monorepo `getUserProjects` in `listMemberProjects` um und pass alle Aufrufer, Tests und Mocks an. Das Verhalten bleibt gleich.',
  ],
  [
    'standard-csv-as-discussed',
    'standard',
    true,
    'Wie oben besprochen: Bau den Export als CSV mit Semikolon als Trenner und den Spalten aus der Tabelle, Datum im deutschen Format.',
  ],
  [
    'standard-stacktrace-inline',
    'standard',
    false,
    [
      'Der CSV-Import stürzt ab, sobald die Datei eine leere Zeile enthält:',
      '',
      "TypeError: Cannot read properties of undefined (reading 'trim')",
      '    at parseRow (apps/api/src/modules/imports/csv.ts:42:18)',
      '    at Array.map (<anonymous>)',
      '',
      'Wie oben zu sehen, fehlt in parseRow der Check auf leere Zeilen. Bitte fixen und einen Test mit einer leeren Zeile ergänzen.',
    ].join('\n'),
  ],
  [
    'standard-newsletter-en',
    'standard',
    false,
    'Draft a short newsletter for our Shopify merchants announcing that VERVE now shows a free-shipping progress bar in the cart. Friendly tone, about 150 words, one call to action.',
  ],
  [
    'standard-same-other-projects',
    ['light', 'standard'],
    true,
    'Mach das gleiche für die Projekte FAM und PRIV, also dieselben Labels mit derselben Farbzuordnung.',
  ],
  [
    'standard-save-button-fix',
    ['light', 'standard'],
    false,
    'Im Einstellungsdialog bleibt der Button „Speichern“ nach einem Serverfehler dauerhaft ausgegraut. Die Ursache ist bekannt: `isSaving` wird im catch-Zweig von useSaveSettings nicht zurückgesetzt. Bitte fixen und einen Test dafür schreiben.',
  ],
  [
    'standard-kita-dates',
    'standard',
    false,
    'In der Mail der Kita Sonnenblume von gestern stehen die Elternabende und Schließtage bis Dezember. Trag die bitte alle in den Familienkalender ein.',
  ],
  [
    'standard-query-param-variant',
    'standard',
    true,
    'Okay, dann nehmen wir die Variante mit dem Query-Parameter statt des Headers. Pass bitte die Aufrufe im Web-Client entsprechend an.',
  ],

  // ── strong ─────────────────────────────────────────────────────────────────────────────
  [
    'strong-kanban-performance',
    'strong',
    false,
    'Die Kanban-Ansicht ruckelt ab etwa 500 Karten massiv beim Scrollen und beim Ziehen. Finde heraus, woran es liegt, und schlag eine Lösung vor, die Drag & Drop, Filter und die Echtzeit-Updates nicht kaputt macht.',
  ],
  [
    'strong-recurring-data-model',
    'strong',
    false,
    'Entwirf das Datenmodell für wiederkehrende Aufgaben mit Ausnahmen (einzelne Vorkommen verschoben oder ausgelassen): Tabellen, Migration und wie der Worker die nächsten Vorkommen erzeugt, ohne nach einem Neustart doppelte Aufgaben anzulegen.',
  ],
  [
    'strong-double-job-en',
    'strong',
    false,
    'Roughly one in fifty deploys, the worker processes the same job twice right after the restart. It never happens locally. Find the root cause; do not just add a dedupe check.',
  ],
  [
    'strong-review-branch',
    'strong',
    false,
    'Review bitte den Branch hub/receipts auf Korrektheit, vor allem die Zuordnung von Teilzahlungen und Gutschriften und die Rundung bei Fremdwährungen.',
  ],
  [
    'strong-competitor-research',
    ['standard', 'strong'],
    false,
    'Recherchiere, welche Shopify-Apps es für Warenkorb-Upsells gibt: Preismodelle, Bewertungen, wichtigste Funktionen. Vergleiche sie ehrlich mit VERVE und liefere das Ergebnis als Tabelle mit Quellen.',
  ],
  [
    'strong-dig-deeper',
    'strong',
    true,
    'Das Caching von eben hat nichts gebracht: Die Zahlen im Dashboard sind nach dem Speichern immer noch veraltet, aber nur bei manchen Nutzern. Grab tiefer.',
  ],
  [
    'strong-continue-migration-en',
    'strong',
    true,
    "Let's continue with the migration plan from before: step 3, moving the attachments from local disk to S3 without downtime and without breaking the existing download links.",
  ],
  [
    'strong-start-page-slow',
    'strong',
    false,
    'Seit dem letzten Release lädt die Startseite doppelt so lange (vorher ca. 800 ms, jetzt 1,6 s). Miss nach, wo die Zeit verloren geht, und behebe die Ursache.',
  ],
  [
    'strong-race-check',
    'strong',
    true,
    'Prüf deinen Fix von vorhin nochmal kritisch: Gibt es Race Conditions, wenn zwei Tabs gleichzeitig dieselbe Aufgabe speichern?',
  ],
  [
    'strong-fulltext-search',
    'strong',
    false,
    'Wir wollen die Suche von LIKE-Abfragen auf eine Volltextsuche mit Ranking umstellen, Deutsch und Englisch gemischt. Welche Optionen haben wir in Postgres, was kostet jede an Aufwand und Leistung, und wie migrieren wir ohne Ausfall?',
  ],

  // ── strongest ──────────────────────────────────────────────────────────────────────────
  [
    'strongest-rotate-keys',
    'strongest',
    false,
    'Rotiere alle API-Schlüssel im Zugänge-Speicher und prüf, ob einer davon jemals in der Git-Historie gelandet ist. Wenn ja, sag mir, was wir sonst noch tun müssen.',
  ],
  [
    'strongest-cease-and-desist',
    'strongest',
    false,
    'Wir haben eine Abmahnung bekommen, weil im Impressum der VERVE-Website angeblich Pflichtangaben fehlen. Die Frist für die Unterlassungserklärung läuft am Freitag ab. Was sollen wir tun?',
  ],
  [
    'strongest-holding-advice',
    'strongest',
    false,
    'Soll ich meine Anteile an der Volition GmbH in eine Holding einbringen? Wäg die steuerlichen und rechtlichen Folgen für mich ab und sag mir, was du empfehlen würdest.',
  ],
  [
    'strongest-billing-subscriptions',
    ['strong', 'strongest'],
    false,
    'Stell die Abrechnung von VERVE von Einmalzahlungen auf Abos um, mit anteiliger Verrechnung beim Tarifwechsel und Rückerstattung bei Kündigung innerhalb von 14 Tagen.',
  ],
  [
    'strongest-auth-audit-en',
    'strongest',
    false,
    'Audit the whole authentication flow for security issues: sessions, CSRF, the OAuth callback, password reset and the API keys the agents use. Write up every finding with severity and a fix.',
  ],
  [
    'strongest-pay-invoice',
    'strongest',
    true,
    'Wie besprochen: Überweise die offene Rechnung von Baumann Elektrotechnik über 1.840 € auf das Konto, das auf der Rechnung steht.',
  ],
  [
    'strongest-compromised-server',
    'strongest',
    false,
    'In /root/.ssh/authorized_keys auf dem Server steht ein Schlüssel, den keiner von uns kennt. Was tun wir jetzt, Schritt für Schritt, ohne Spuren zu vernichten?',
  ],
  [
    'strongest-consumer-law-en',
    'strongest',
    false,
    'A merchant claims the cancellation terms in our VERVE app listing violate EU consumer law and threatens to report us. Is he right, and how should we answer him?',
  ],
];

export const ROUTER_EVAL_CASES: DecisionEvalCase[] = CASES.map(
  ([id, route, needsContext, message]) => ({
    id: `router.${id}`,
    context: message,
    questions: routerQuestions(),
    expected: { route, needs_context: needsContext ? 'yes' : 'no' },
  }),
);

export const ROUTER_EVAL: DecisionEvalSet = {
  cases: ROUTER_EVAL_CASES,
  minPrecision: 0.85,
  minCoverage: 0.5,
};
