import {
  median,
  type LocalAiEvalCaseResult,
  type LocalAiEvalContext,
  type LocalAiEvalResult,
} from '@helena/sdk';

// The small evals a local model has to pass before a kind of work may run on it
// (docs/helena-decisions/local-ai-platform.md §7). Each is a fixed set of cases with an
// answer a program can check: no second model judges the first. They are deliberately
// small (a minute on the workhorse model), mostly German, the owner's language, with some
// English, and they test what the work needs: the right tool with the right arguments, the
// facts of a text kept, the right label, the right document found.

function clip(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function result(cases: LocalAiEvalCaseResult[], outputTokens: number, seconds: number) {
  const passed = cases.filter((entry) => entry.passed).length;
  return {
    score: cases.length === 0 ? 0 : passed / cases.length,
    cases,
    latencyMsP50: median(cases.map((entry) => entry.latencyMs ?? NaN)),
    tokensPerSecond: seconds > 0 && outputTokens > 0 ? outputTokens / seconds : null,
  } satisfies LocalAiEvalResult;
}

// The first JSON object in an answer; a model that talks around it is forgiven.
export function firstJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const value = JSON.parse(text.slice(start, end + 1));
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// A reasoning model may think out loud first; only what follows its thinking counts.
export function withoutThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

// ── Triage: the right label for a task ──────────────────────────────────────────────────

const TRIAGE_LABELS = ['bug', 'feature', 'question', 'ops', 'content'] as const;

export const TRIAGE_CASES: { id: string; text: string; label: (typeof TRIAGE_LABELS)[number] }[] = [
  { id: 't1', text: 'Der Warenkorb zeigt nach dem Update den falschen Preis an.', label: 'bug' },
  {
    id: 't2',
    text: 'Checkout wirft Fehler 500, sobald ein Gutschein eingelöst wird.',
    label: 'bug',
  },
  {
    id: 't3',
    text: 'Login-Seite lädt auf dem iPhone nicht mehr, weißer Bildschirm.',
    label: 'bug',
  },
  { id: 't4', text: 'Wir brauchen einen Export der Bestellungen als CSV.', label: 'feature' },
  {
    id: 't5',
    text: 'Bitte eine Dunkelmodus-Option für das Kundenportal einbauen.',
    label: 'feature',
  },
  { id: 't6', text: 'Add a filter for orders by shipping country.', label: 'feature' },
  {
    id: 't7',
    text: 'Wie lange dauert es normalerweise, bis eine Rückerstattung ankommt?',
    label: 'question',
  },
  {
    id: 't8',
    text: 'Weißt du, ob Shopify das neue Checkout-API schon für alle freigibt?',
    label: 'question',
  },
  {
    id: 't9',
    text: 'Can you explain what the difference between plan A and plan B is?',
    label: 'question',
  },
  { id: 't10', text: 'Das SSL-Zertifikat der Domain läuft in drei Tagen ab.', label: 'ops' },
  { id: 't11', text: 'Backup-Job ist heute Nacht fehlgeschlagen, Platte fast voll.', label: 'ops' },
  {
    id: 't12',
    text: 'Server braucht ein Kernel-Update und einen Neustart am Wochenende.',
    label: 'ops',
  },
  {
    id: 't13',
    text: 'Schreib einen Blogartikel über unsere neue Herbstkollektion.',
    label: 'content',
  },
  { id: 't14', text: 'Die Produkttexte für die drei neuen Taschen fehlen noch.', label: 'content' },
  { id: 't15', text: 'Draft a newsletter announcing the summer sale.', label: 'content' },
  {
    id: 't16',
    text: 'Nach dem Deploy stürzt die App beim Öffnen der Einstellungen ab.',
    label: 'bug',
  },
];

const TRIAGE_SYSTEM =
  'Du ordnest Aufgaben einer Kategorie zu. Antworte nur mit JSON: {"label": "<kategorie>"}. ' +
  `Kategorien: ${TRIAGE_LABELS.join(', ')}. bug = etwas ist kaputt; feature = etwas Neues ` +
  'soll gebaut werden; question = eine Frage; ops = Betrieb, Server, Zertifikate, Backups; ' +
  'content = Texte schreiben.';

export async function evaluateTriage(context: LocalAiEvalContext): Promise<LocalAiEvalResult> {
  const cases: LocalAiEvalCaseResult[] = [];
  let tokens = 0;
  let seconds = 0;
  for (const item of TRIAGE_CASES) {
    const answer = await context.chat({
      system: TRIAGE_SYSTEM,
      prompt: item.text,
      json: true,
      maxTokens: 400,
    });
    tokens += answer.outputTokens ?? 0;
    seconds += answer.latencyMs / 1000;
    const label = String(firstJson(withoutThinking(answer.text))?.label ?? '')
      .trim()
      .toLowerCase();
    cases.push({
      id: item.id,
      passed: label === item.label,
      detail:
        label === item.label
          ? null
          : `expected ${item.label}, got ${clip(label || answer.text, 60)}`,
      latencyMs: answer.latencyMs,
    });
  }
  return result(cases, tokens, seconds);
}

// ── Summaries: facts kept, German, short, valid JSON ────────────────────────────────────

export const SUMMARY_CASES: { id: string; text: string; facts: string[][]; maxWords: number }[] = [
  {
    id: 's1',
    text:
      'Version 2.4.0 von Hermes bringt eine neue Kontext-Kompression, die lange Sitzungen ' +
      'um etwa 60 Prozent kürzt. Die alte Option compression.summary_model wurde entfernt ' +
      'und muss durch auxiliary.compression ersetzt werden. Außerdem behebt das Update eine ' +
      'Sicherheitslücke (CVE-2026-4411) im MCP-Client. Die Mindestversion von Python ist jetzt 3.12.',
    facts: [
      ['2.4.0', '2.4'],
      ['kompression', 'compression'],
      ['cve-2026-4411', 'sicherheit'],
      ['3.12'],
    ],
    maxWords: 90,
  },
  {
    id: 's2',
    text:
      'Im September hatten wir 1.240 Bestellungen, 18 Prozent mehr als im August. Die ' +
      'Retourenquote stieg auf 7,5 Prozent, vor allem wegen der Größen bei den Winterjacken. ' +
      'Der Umsatz lag bei 86.000 Euro. Für Oktober ist eine Rabattaktion zum Black Friday geplant.',
    facts: [
      ['1.240', '1240'],
      ['18'],
      ['7,5', '7.5'],
      ['86.000', '86000', '86 000'],
      ['black friday'],
    ],
    maxWords: 90,
  },
  {
    id: 's3',
    text:
      'The agent run failed three times because the Codex model gpt-6-terra is not available ' +
      'for the ChatGPT account. The run was moved to gpt-5.6-terra and finished in 4 minutes. ' +
      'Two tasks, VOL-12 and VOL-14, were closed; VOL-15 is waiting for the owner.',
    facts: [['gpt-6-terra'], ['gpt-5.6-terra'], ['vol-12'], ['vol-14'], ['vol-15']],
    maxWords: 90,
  },
  {
    id: 's4',
    text:
      'Das RAID 1 wurde um 21:46 in Betrieb genommen. Die zweite Platte synchronisiert noch, ' +
      'geschätzt zwei Stunden. Bis dahin gibt es keine Redundanz. Der Reserve-Boot über die ' +
      'zweite EFI-Partition ist eingerichtet, aber noch nicht getestet.',
    facts: [['raid'], ['21:46', '21.46'], ['synchron', 'sync'], ['redundanz'], ['reserve', 'efi']],
    maxWords: 90,
  },
];

const SUMMARY_SYSTEM =
  'Fasse den Text auf Deutsch zusammen. Behalte alle Zahlen, Versionen und Kennungen genau ' +
  'bei. Antworte nur mit JSON: {"summary": "<höchstens drei Sätze>"}.';

const GERMAN_WORDS = /\b(der|die|das|und|ist|wurde|wird|mit|für|auf|nicht|ein|eine|im)\b/gi;

export async function evaluateSummaries(context: LocalAiEvalContext): Promise<LocalAiEvalResult> {
  const cases: LocalAiEvalCaseResult[] = [];
  let tokens = 0;
  let seconds = 0;
  for (const item of SUMMARY_CASES) {
    const answer = await context.chat({
      system: SUMMARY_SYSTEM,
      prompt: item.text,
      json: true,
      maxTokens: 800,
    });
    tokens += answer.outputTokens ?? 0;
    seconds += answer.latencyMs / 1000;
    const summary = String(firstJson(withoutThinking(answer.text))?.summary ?? '');
    const lower = summary.toLowerCase();
    const missing = item.facts.filter((any) => !any.some((fact) => lower.includes(fact)));
    const words = summary.split(/\s+/).filter(Boolean).length;
    const german = (summary.match(GERMAN_WORDS) ?? []).length >= 3;
    const problems = [
      ...(summary ? [] : ['no JSON summary']),
      ...(missing.length ? [`missing ${missing.map((any) => any[0]).join(', ')}`] : []),
      ...(words > item.maxWords ? [`${words} words`] : []),
      ...(summary && !german ? ['not German'] : []),
    ];
    cases.push({
      id: item.id,
      passed: problems.length === 0,
      detail: problems.length ? problems.join('; ') : null,
      latencyMs: answer.latencyMs,
    });
  }
  return result(cases, tokens, seconds);
}

// ── Hermes' helper calls: a session title, a compression that keeps the facts ──────────

const TITLE_CASES: { id: string; conversation: string; words: string[] }[] = [
  {
    id: 'h1',
    conversation:
      'Person: Kannst du die Lieferzeiten im Shop auf 3–5 Werktage ändern?\n' +
      'Agent: Erledigt, die Versandseite und die Produktseiten zeigen jetzt 3–5 Werktage.',
    words: ['lieferzeit', 'versand'],
  },
  {
    id: 'h2',
    conversation:
      'Person: Prüf bitte, warum das Backup heute Nacht fehlgeschlagen ist.\n' +
      'Agent: Die Platte war voll; ich habe alte Snapshots entfernt und das Backup neu gestartet.',
    words: ['backup'],
  },
  {
    id: 'h3',
    conversation:
      'Person: Write the release notes for version 3.1 of the cart app.\n' +
      'Agent: Here are the release notes for 3.1: faster checkout, new coupon rules.',
    words: ['release', '3.1', 'notes'],
  },
];

const TITLE_SYSTEM =
  'Gib dem Gespräch einen kurzen Titel (höchstens sechs Wörter) in seiner Sprache. ' +
  'Antworte nur mit dem Titel.';

const COMPRESSION_TEXT = [
  'Person: Bitte richte für das Projekt VERVE eine wöchentliche Routine ein, montags 8:00.',
  'Agent: Routine "Wochenbericht VERVE" angelegt, montags 08:00 Europe/Berlin, Agent @coder-verve.',
  'Person: Der Bericht soll Umsatz, Retouren und offene Tickets enthalten.',
  'Agent: Ergänzt. Quelle für Umsatz ist der Shopify-Export, für Tickets das Board VERVE.',
  'Person: Und schick ihn an patrick@example.com, nicht an das Team.',
  'Agent: Empfänger geändert auf patrick@example.com. Nächster Lauf: Montag, 28.09., 08:00.',
].join('\n');

const COMPRESSION_FACTS = [
  ['verve'],
  ['montag', 'monday'],
  ['8:00', '08:00'],
  ['umsatz'],
  ['retoure'],
  ['ticket'],
  ['patrick@example.com'],
  ['28.09', '28. september'],
];

const COMPRESSION_SYSTEM =
  'Fasse das bisherige Gespräch so zusammen, dass ein Agent ohne den Verlauf weiterarbeiten ' +
  'kann. Behalte jede Entscheidung, Zeit, Adresse und Kennung genau bei. Höchstens 120 Wörter.';

export async function evaluateHermesHelpers(
  context: LocalAiEvalContext,
): Promise<LocalAiEvalResult> {
  const cases: LocalAiEvalCaseResult[] = [];
  let tokens = 0;
  let seconds = 0;
  for (const item of TITLE_CASES) {
    const answer = await context.chat({
      system: TITLE_SYSTEM,
      prompt: item.conversation,
      maxTokens: 300,
    });
    tokens += answer.outputTokens ?? 0;
    seconds += answer.latencyMs / 1000;
    const title = withoutThinking(answer.text)
      .split('\n')[0]!
      .replace(/^["'„]|["'“]$/g, '');
    const words = title.split(/\s+/).filter(Boolean).length;
    const topical = item.words.some((word) => title.toLowerCase().includes(word));
    const passed = words > 0 && words <= 8 && topical;
    cases.push({
      id: item.id,
      passed,
      detail: passed ? null : `title "${clip(title, 80)}"`,
      latencyMs: answer.latencyMs,
    });
  }
  const answer = await context.chat({
    system: COMPRESSION_SYSTEM,
    prompt: COMPRESSION_TEXT,
    maxTokens: 900,
  });
  tokens += answer.outputTokens ?? 0;
  seconds += answer.latencyMs / 1000;
  const summary = withoutThinking(answer.text).toLowerCase();
  const missing = COMPRESSION_FACTS.filter((any) => !any.some((fact) => summary.includes(fact)));
  cases.push({
    id: 'compression',
    passed: missing.length === 0,
    detail: missing.length ? `lost ${missing.map((any) => any[0]).join(', ')}` : null,
    latencyMs: answer.latencyMs,
  });
  return result(cases, tokens, seconds);
}

// ── Routine agents: the right tool with the right arguments ─────────────────────────────

const ROUTINE_TOOLS = [
  {
    name: 'create_task',
    description: 'Legt eine Aufgabe im Projekt an.',
    parameters: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Projektschlüssel, z. B. VOL' },
        title: { type: 'string' },
        due: { type: 'string', description: 'Fälligkeit als YYYY-MM-DD' },
      },
      required: ['project', 'title'],
    },
  },
  {
    name: 'add_comment',
    description: 'Schreibt einen Kommentar an eine bestehende Aufgabe.',
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Kennung wie VOL-12' },
        text: { type: 'string' },
      },
      required: ['task', 'text'],
    },
  },
  {
    name: 'set_status',
    description: 'Setzt den Status einer Aufgabe.',
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string' },
        status: { type: 'string', enum: ['todo', 'in_progress', 'review', 'done'] },
      },
      required: ['task', 'status'],
    },
  },
  {
    name: 'search_knowledge',
    description: 'Sucht in der Wissensbasis.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
];

export const ROUTINE_CASES: {
  id: string;
  prompt: string;
  tool: string;
  args: Record<string, (value: unknown) => boolean>;
}[] = [
  {
    id: 'r1',
    prompt: 'Lege im Projekt VOL die Aufgabe "Impressum prüfen" an, fällig am 2026-10-01.',
    tool: 'create_task',
    args: {
      project: (value) => String(value).toUpperCase() === 'VOL',
      title: (value) => /impressum/i.test(String(value)),
      due: (value) => String(value) === '2026-10-01',
    },
  },
  {
    id: 'r2',
    prompt: 'Schreib an VOL-12 den Kommentar: "Backup läuft wieder."',
    tool: 'add_comment',
    args: {
      task: (value) => String(value).toUpperCase() === 'VOL-12',
      text: (value) => /backup/i.test(String(value)),
    },
  },
  {
    id: 'r3',
    prompt: 'VERVE-7 ist fertig, setz es auf erledigt.',
    tool: 'set_status',
    args: {
      task: (value) => String(value).toUpperCase() === 'VERVE-7',
      status: (value) => String(value) === 'done',
    },
  },
  {
    id: 'r4',
    prompt: 'Was steht in unserer Wissensbasis zur Retourenregelung?',
    tool: 'search_knowledge',
    args: { query: (value) => /retour/i.test(String(value)) },
  },
  {
    id: 'r5',
    prompt: 'Move task FAM-3 to review.',
    tool: 'set_status',
    args: {
      task: (value) => String(value).toUpperCase() === 'FAM-3',
      status: (value) => String(value) === 'review',
    },
  },
  {
    id: 'r6',
    prompt: 'Create a task in PRIV called "Steuererklärung vorbereiten".',
    tool: 'create_task',
    args: {
      project: (value) => String(value).toUpperCase() === 'PRIV',
      title: (value) => /steuer/i.test(String(value)),
    },
  },
  {
    id: 'r7',
    prompt: 'Kommentiere VERVE-21 mit "Texte sind online".',
    tool: 'add_comment',
    args: {
      task: (value) => String(value).toUpperCase() === 'VERVE-21',
      text: (value) => /online/i.test(String(value)),
    },
  },
  {
    id: 'r8',
    prompt: 'Such in der Wissensbasis nach dem Zugang zum Newsletter-Tool.',
    tool: 'search_knowledge',
    args: { query: (value) => /newsletter/i.test(String(value)) },
  },
];

export async function evaluateRoutines(context: LocalAiEvalContext): Promise<LocalAiEvalResult> {
  const cases: LocalAiEvalCaseResult[] = [];
  let tokens = 0;
  let seconds = 0;
  for (const item of ROUTINE_CASES) {
    const answer = await context.chat({
      system: 'Du bist ein Agent. Nutze genau ein Werkzeug für die Bitte.',
      prompt: item.prompt,
      tools: ROUTINE_TOOLS,
      maxTokens: 600,
    });
    tokens += answer.outputTokens ?? 0;
    seconds += answer.latencyMs / 1000;
    const call = answer.toolCalls[0];
    let args: Record<string, unknown> = {};
    try {
      args = call ? (JSON.parse(call.arguments) as Record<string, unknown>) : {};
    } catch {
      args = {};
    }
    const wrongArgs = Object.entries(item.args)
      .filter(([name, check]) => !check(args[name]))
      .map(([name]) => name);
    const passed = call?.name === item.tool && wrongArgs.length === 0;
    cases.push({
      id: item.id,
      passed,
      detail: passed
        ? null
        : call
          ? `called ${call.name}${wrongArgs.length ? `, wrong ${wrongArgs.join(', ')}` : ''}`
          : `no tool call: ${clip(answer.text, 80)}`,
      latencyMs: answer.latencyMs,
    });
  }
  return result(cases, tokens, seconds);
}

// ── Embeddings: the right document for a question ──────────────────────────────────────

export const EMBEDDING_DOCS: { id: string; text: string }[] = [
  {
    id: 'd1',
    text: 'Rücksendungen sind innerhalb von 30 Tagen kostenlos möglich; das Etikett liegt dem Paket bei.',
  },
  { id: 'd2', text: 'Das WLAN im Büro heißt Volition-Gast, das Passwort hängt am Kühlschrank.' },
  {
    id: 'd3',
    text: 'Backups laufen jede Nacht um 02:00 mit restic auf das RAID und wöchentlich extern.',
  },
  {
    id: 'd4',
    text: 'The newsletter is sent every first Monday of the month through the mail tool.',
  },
  { id: 'd5', text: 'Die Steuerberaterin braucht die Belege bis zum 10. des Folgemonats.' },
  {
    id: 'd6',
    text: 'Shopify orders are synced to the warehouse every 15 minutes via the webhook.',
  },
  {
    id: 'd7',
    text: 'Der Server im Keller hat 128 GB Speicher, davon 96 GB für die Grafik reserviert.',
  },
  {
    id: 'd8',
    text: 'Urlaubsanträge gehen über das Board FAM an Patrick, mindestens zwei Wochen vorher.',
  },
];

export const EMBEDDING_QUERIES: { id: string; query: string; doc: string }[] = [
  { id: 'q1', query: 'Wie lange kann ein Kunde Ware zurückschicken?', doc: 'd1' },
  { id: 'q2', query: 'return policy days', doc: 'd1' },
  { id: 'q3', query: 'Wann werden die Daten gesichert?', doc: 'd3' },
  { id: 'q4', query: 'When does the newsletter go out?', doc: 'd4' },
  { id: 'q5', query: 'Bis wann müssen die Quittungen beim Steuerbüro sein?', doc: 'd5' },
  { id: 'q6', query: 'Wie oft kommen neue Bestellungen im Lager an?', doc: 'd6' },
  { id: 'q7', query: 'Wie viel VRAM hat die Maschine?', doc: 'd7' },
  { id: 'q8', query: 'Wo beantrage ich freie Tage?', doc: 'd8' },
  { id: 'q9', query: 'guest wifi password office', doc: 'd2' },
  { id: 'q10', query: 'Wohin gehen die nächtlichen Sicherungen?', doc: 'd3' },
];

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
}

export async function evaluateEmbeddings(context: LocalAiEvalContext): Promise<LocalAiEvalResult> {
  const docs = await context.embed(EMBEDDING_DOCS.map((doc) => doc.text));
  const queries = await context.embed(EMBEDDING_QUERIES.map((item) => item.query));
  const latency = (docs.latencyMs + queries.latencyMs) / 2;
  const cases = EMBEDDING_QUERIES.map((item, index) => {
    const vector = queries.vectors[index] ?? [];
    const ranked = EMBEDDING_DOCS.map((doc, docIndex) => ({
      id: doc.id,
      score: cosine(vector, docs.vectors[docIndex] ?? []),
    })).sort((a, b) => b.score - a.score);
    const passed = ranked[0]?.id === item.doc;
    return {
      id: item.id,
      passed,
      detail: passed ? null : `expected ${item.doc}, ranked ${ranked[0]?.id ?? 'none'} first`,
      latencyMs: latency,
    };
  });
  return result(cases, 0, 0);
}
