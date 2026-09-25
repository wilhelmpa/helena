import type { DecisionEvalCase, DecisionEvalSet, DecisionQuestion } from '@helena/sdk';

// Labelled cases of general typed decisions (docs/helena-decisions/decisions.md §7): the kind
// of question an agent (MCP tool `decide`) or a workflow step "Entscheidung" asks about a
// text. Questions and options are in English like Helena's own; the texts are German (and a
// few other languages where the language is the question). People and companies are invented.

const SENTIMENT: DecisionQuestion = {
  kind: 'choice',
  question: 'What is the overall sentiment of this customer message?',
  options: [
    { id: 'positive', label: 'Positive: satisfied, thankful or praising.' },
    { id: 'neutral', label: 'Neutral: factual, without noticeable emotion.' },
    { id: 'negative', label: 'Negative: dissatisfied, annoyed or disappointed.' },
    { id: 'mixed', label: 'Mixed: clearly positive and clearly negative parts.' },
  ],
};

const DEPARTMENT: DecisionQuestion = {
  kind: 'choice',
  question: 'Which team should handle this ticket?',
  options: [
    { id: 'support', label: 'Support: technical problems, errors, how to use the product.' },
    {
      id: 'billing',
      label: 'Billing: invoices, payments, billing addresses, plan and contract administration.',
    },
    {
      id: 'sales',
      label: 'Sales: prospective customers, pricing questions before a purchase, larger deals.',
    },
    { id: 'hr', label: 'HR: job applications, employees, recruiting.' },
    { id: 'other', label: 'None of these teams.' },
  ],
};

const COMPLAINT: DecisionQuestion = {
  kind: 'yesno',
  question: 'Is this message a complaint about the product, the service or the company?',
};

const DEADLINE: DecisionQuestion = {
  kind: 'yesno',
  question:
    'Does this text set a deadline for its reader, a date or time by which something must be done?',
};

const LANGUAGE: DecisionQuestion = {
  kind: 'choice',
  question: 'In which language is this text written?',
  options: [
    { id: 'de', label: 'German' },
    { id: 'en', label: 'English' },
    { id: 'fr', label: 'French' },
    { id: 'es', label: 'Spanish' },
    { id: 'it', label: 'Italian' },
    { id: 'nl', label: 'Dutch' },
    { id: 'other', label: 'Another language' },
  ],
};

const MEETING_REPLY: DecisionQuestion = {
  kind: 'choice',
  question: 'How does this reply answer the invitation to a meeting?',
  options: [
    { id: 'accepted', label: 'Accepted: the person will attend at the proposed time.' },
    { id: 'declined', label: 'Declined: the person will not attend and proposes nothing else.' },
    { id: 'tentative', label: 'Tentative: the person may attend but cannot commit yet.' },
    { id: 'new_time', label: 'New time: the person proposes a different time instead.' },
  ],
};

const REVIEW_CHANGE: DecisionQuestion = {
  kind: 'yesno',
  question:
    'Does this code review comment ask the author to change the code in this pull request before it is merged?',
};

const ISSUE_LABEL: DecisionQuestion = {
  kind: 'choice',
  question: 'Which label fits this issue best?',
  options: [
    { id: 'bug', label: 'Bug: something does not work as it should.' },
    { id: 'feature', label: 'Feature: a wish for new or extended functionality.' },
    { id: 'question', label: 'Question: someone asks how something works.' },
    { id: 'docs', label: 'Docs: documentation is missing, wrong or outdated.' },
    { id: 'chore', label: 'Chore: maintenance such as dependencies, build or cleanup.' },
  ],
};

const CUSTOMER_INTENT: DecisionQuestion = {
  kind: 'choice',
  question: 'What does the customer want?',
  options: [
    { id: 'cancel', label: 'Cancel: end the subscription or contract.' },
    { id: 'upgrade', label: 'Upgrade: move to a bigger plan or buy more.' },
    {
      id: 'question',
      label: 'Question: learn how something works, without changing the plan.',
    },
    { id: 'feedback', label: 'Feedback: praise or criticism, without a request.' },
    { id: 'other', label: 'Something else.' },
  ],
};

type Expected = Record<string, string | string[]>;

interface GenericCase {
  id: string;
  context: string;
  ask: Record<string, DecisionQuestion>;
  expected: Expected;
}

const CASES: GenericCase[] = [
  // ── sentiment ──────────────────────────────────────────────────────────────────────────
  {
    id: 'sentiment-praise',
    context:
      'Hallo Team, ich wollte nur kurz sagen: Seit dem Update lädt das Dashboard endlich schnell, und der neue Export spart mir jede Woche eine Stunde. Weiter so! Viele Grüße, Sabine Roth',
    ask: { sentiment: SENTIMENT },
    expected: { sentiment: 'positive' },
  },
  {
    id: 'sentiment-angry-complaint',
    context:
      'Das ist jetzt das dritte Mal in diesem Monat, dass die Synchronisation mit unserem Shop ausfällt. Wir verlieren Bestellungen, und auf mein Ticket vom Montag hat niemand reagiert. So kann ich euch nicht weiterempfehlen.',
    ask: { sentiment: SENTIMENT, complaint: COMPLAINT },
    expected: { sentiment: 'negative', complaint: 'yes' },
  },
  {
    id: 'sentiment-mixed',
    context:
      'Die neue Oberfläche gefällt mir richtig gut, viel übersichtlicher als vorher. Allerdings finde ich die Exportfunktion nicht mehr, und die brauche ich täglich. Das ist gerade ziemlich ärgerlich.',
    ask: { sentiment: SENTIMENT },
    expected: { sentiment: 'mixed' },
  },
  {
    id: 'complaint-no-despite-problem-words',
    context:
      'Ich hatte letzte Woche Probleme mit dem Import, aber Ihr Support hat das super schnell gelöst. Danke nochmal an Herrn Petersen!',
    ask: { complaint: COMPLAINT, sentiment: SENTIMENT },
    expected: { complaint: 'no', sentiment: 'positive' },
  },

  // ── department ─────────────────────────────────────────────────────────────────────────
  {
    id: 'department-billing-address',
    context:
      'Bitte ändern Sie ab November unsere Rechnungsadresse auf: Kessler Logistik GmbH, Am Hafen 7, 28195 Bremen. Die Bestellnummer auf den Rechnungen bleibt gleich. Danke!',
    ask: { department: DEPARTMENT, sentiment: SENTIMENT },
    expected: { department: 'billing', sentiment: 'neutral' },
  },
  {
    id: 'department-support-login',
    context:
      'Seit heute Morgen bekomme ich beim Anmelden die Meldung „Sitzung abgelaufen“, obwohl ich mich gerade erst angemeldet habe. Browser-Cache habe ich schon geleert, in einem anderen Browser passiert dasselbe.',
    ask: { department: DEPARTMENT },
    expected: { department: 'support' },
  },
  {
    id: 'department-sales-enterprise',
    context:
      'Wir sind ein Team von 40 Leuten und überlegen, von unserem jetzigen Tool zu wechseln. Gibt es bei Ihnen Staffelpreise oder einen Enterprise-Tarif mit Single Sign-on? Gern auch ein kurzes Gespräch nächste Woche.',
    ask: { department: DEPARTMENT },
    expected: { department: 'sales' },
  },
  {
    id: 'department-hr-application',
    context:
      'Sehr geehrte Damen und Herren, anbei sende ich Ihnen meine Bewerbung als Werkstudentin im Bereich Frontend-Entwicklung (Lebenslauf und Zeugnisse als PDF). Ich studiere Medieninformatik im 5. Semester. Mit freundlichen Grüßen, Clara Neumann',
    ask: { department: DEPARTMENT },
    expected: { department: 'hr' },
  },

  // ── deadline ───────────────────────────────────────────────────────────────────────────
  {
    id: 'deadline-explicit-date',
    context:
      'Bitte reichen Sie die unterschriebene Vereinbarung bis spätestens 15. Oktober bei uns ein, sonst verfällt das Angebot.',
    ask: { deadline: DEADLINE },
    expected: { deadline: 'yes' },
  },
  {
    id: 'deadline-dates-without-deadline',
    context:
      'Am 3. Oktober bleibt unser Büro geschlossen. Ab Montag, dem 6. Oktober, sind wir wieder wie gewohnt von 8 bis 17 Uhr für Sie da.',
    ask: { deadline: DEADLINE },
    expected: { deadline: 'no' },
  },
  {
    id: 'deadline-relative',
    context:
      'Kannst du mir die Umsatzzahlen für das dritte Quartal bis morgen früh schicken? Ich brauche sie für die Sitzung mit dem Beirat um zehn.',
    ask: { deadline: DEADLINE },
    expected: { deadline: 'yes' },
  },

  // ── language ───────────────────────────────────────────────────────────────────────────
  {
    id: 'language-italian',
    context:
      'Buongiorno, vorrei sapere se la vostra app funziona anche con temi Shopify personalizzati. Grazie mille, Giulia',
    ask: { language: LANGUAGE },
    expected: { language: 'it' },
  },
  {
    id: 'language-dutch',
    context:
      'Hoi, ik heb gisteren de Pro-versie gekocht, maar ik zie de nieuwe functies nog niet in mijn winkel. Kunnen jullie even kijken? Groetjes, Sanne',
    ask: { language: LANGUAGE },
    expected: { language: 'nl' },
  },

  // ── meeting replies ────────────────────────────────────────────────────────────────────
  {
    id: 'meeting-accepted',
    context: 'Passt, Donnerstag 10 Uhr bin ich dabei. Schickst du mir noch den Link?',
    ask: { reply: MEETING_REPLY },
    expected: { reply: 'accepted' },
  },
  {
    id: 'meeting-counter-proposal',
    context:
      'Diese Woche klappt es leider nicht mehr, ich bin bis Freitag auf Dienstreise. Wie wäre es mit Dienstag nächster Woche, 14 Uhr?',
    ask: { reply: MEETING_REPLY },
    expected: { reply: ['new_time', 'declined'] },
  },
  {
    id: 'meeting-tentative',
    context:
      'Ich versuche es einzurichten, kann aber noch nicht fest zusagen – das hängt davon ab, ob mein Flug aus Lissabon pünktlich landet. Ich melde mich spätestens am Vormittag.',
    ask: { reply: MEETING_REPLY },
    expected: { reply: 'tentative' },
  },

  // ── code review comments ───────────────────────────────────────────────────────────────
  {
    id: 'review-missing-error-handling',
    context:
      'Hier fehlt noch die Fehlerbehandlung, falls die API mit 404 antwortet – kannst du das ergänzen, bevor wir mergen?',
    ask: { change: REVIEW_CHANGE },
    expected: { change: 'yes' },
  },
  {
    id: 'review-praise-only',
    context:
      'Schöne Lösung mit dem Early Return, liest sich viel besser als vorher. Von mir aus gern so.',
    ask: { change: REVIEW_CHANGE },
    expected: { change: 'no' },
  },
  {
    id: 'review-fyi-not-in-this-pr',
    context:
      'Nur zur Info: In main gibt es inzwischen einen Helper `formatDate`, den könnte man hier später mal nutzen. Muss aber nicht in diesem PR sein.',
    ask: { change: REVIEW_CHANGE },
    expected: { change: 'no' },
  },

  // ── issue labels ───────────────────────────────────────────────────────────────────────
  {
    id: 'label-bug-umlauts',
    context:
      'Beim Export nach Excel werden Umlaute als Fragezeichen dargestellt (z. B. „M?nchen“ statt „München“). Tritt seit Version 2.3 auf, vorher ging es.',
    ask: { label: ISSUE_LABEL },
    expected: { label: 'bug' },
  },
  {
    id: 'label-feature-biweekly',
    context:
      'Es wäre super, wenn man wiederkehrende Aufgaben auch alle zwei Wochen anlegen könnte, nicht nur wöchentlich oder monatlich.',
    ask: { label: ISSUE_LABEL },
    expected: { label: 'feature' },
  },
  {
    id: 'label-docs-outdated-command',
    context:
      'Im README steht noch der alte Befehl `npm run setup`. Den gibt es seit dem Umstieg auf Bun nicht mehr, neue Leute bleiben daran hängen.',
    ask: { label: ISSUE_LABEL },
    expected: { label: 'docs' },
  },

  // ── customer intent ────────────────────────────────────────────────────────────────────
  {
    id: 'intent-cancel-asked-as-question',
    context:
      'Wie kündige ich zum Monatsende? Ich finde die Option in den Einstellungen nicht. Wir stellen den Onlineshop Ende Oktober ein.',
    ask: { intent: CUSTOMER_INTENT },
    expected: { intent: 'cancel' },
  },
  {
    id: 'intent-upgrade-more-seats',
    context:
      'Wir brauchen mehr als die drei Nutzer im Starter-Tarif. Was müssen wir tun, um auf den Team-Tarif zu wechseln, und wird der Rest des Monats verrechnet?',
    ask: { intent: CUSTOMER_INTENT },
    expected: { intent: 'upgrade' },
  },
];

export const GENERIC_EVAL_CASES: DecisionEvalCase[] = CASES.map((entry) => ({
  id: `generic.${entry.id}`,
  context: entry.context,
  questions: entry.ask,
  expected: entry.expected,
}));

export const GENERIC_EVAL: DecisionEvalSet = {
  cases: GENERIC_EVAL_CASES,
  minPrecision: 0.85,
  minCoverage: 0.5,
};
