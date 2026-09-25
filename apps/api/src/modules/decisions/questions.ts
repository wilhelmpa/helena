import type { DecisionOption, DecisionQuestion } from '@helena/sdk';

// The questions Helena's own decision classes ask (docs/helena-decisions/decisions.md §4–§7).
// The live features and the evals build them here, so an eval measures exactly what the
// feature asks. Questions and options are in English: the decision models read English best
// (TypeSafe names it; Laya's typed-decisions checkpoint is English only); the content they are
// about (a prompt, a mail, a receipt) stays in whatever language it came in.

// ── The model router ──────────────────────────────────────────────────────────────────────

export type RouterTier = 'light' | 'standard' | 'strong' | 'strongest';

export const ROUTER_TIERS: readonly RouterTier[] = ['light', 'standard', 'strong', 'strongest'];

export const ROUTER_TIER_OPTIONS: Record<RouterTier, string> = {
  light:
    'Trivial work: find or look something up, read and report back, list or briefly summarise, ' +
    'a one-line or one-file change with no design decision, a simple factual question.',
  standard:
    'Routine work: a well-specified change or fix across a few files, writing or fixing tests, ' +
    'a routine refactor, drafting an ordinary text or mail, working through a given checklist.',
  strong:
    'Hard work: several steps with trade-offs, subtle debugging, performance, designing an ' +
    'architecture or data model, reviewing work for correctness, careful research.',
  strongest:
    'Highest stakes or open-ended work: security, credentials, payments, legal or financial ' +
    'consequences; ambiguous decisions that need judgment or advice rather than execution; deep ' +
    'reasoning across a whole project.',
};

// The tiers offered are the configured model's and those below it (and one above it where the
// owner allowed an upgrade), so the question never offers what the router may not choose.
export function routerQuestions(tiers: readonly RouterTier[] = ROUTER_TIERS) {
  return {
    route: {
      kind: 'choice',
      question:
        'Which is the cheapest model tier that can complete this request to an AI agent well? ' +
        'A cheaper tier starts fresh and reads what it needs from the project itself.',
      options: tiers.map((tier) => ({ id: tier, label: ROUTER_TIER_OPTIONS[tier] })),
    },
    needs_context: {
      kind: 'yesno',
      question:
        'Does handling this request depend on the earlier conversation or earlier work (it ' +
        'refers to "this", "that", "above", "as discussed", "continue", "the same", or it ' +
        'answers a question), rather than being understandable on its own?',
    },
  } satisfies Record<string, DecisionQuestion>;
}

// ── The mail classifier ───────────────────────────────────────────────────────────────────

export const MAIL_CATEGORIES = [
  'invoice',
  'appointment',
  'request',
  'newsletter',
  'notification',
  'personal',
  'advertising',
  'other',
] as const;
export type MailCategory = (typeof MAIL_CATEGORIES)[number];

export const MAIL_CATEGORY_OPTIONS: Record<MailCategory, string> = {
  invoice:
    'An invoice, receipt, bill, payment reminder or order confirmation with an amount to pay ' +
    'or paid.',
  appointment: 'An appointment, meeting, invitation, booking or a change of a schedule.',
  request:
    'A request or question from a customer, partner or anyone who wants something from the ' +
    'recipient personally.',
  newsletter: 'A newsletter, digest or other regular editorial mailing.',
  notification:
    'An automatic notification of a service or system: shipping, account, security, status, ' +
    'monitoring, a message about an order already placed.',
  personal: 'A personal message from family, friends or acquaintances.',
  advertising: 'Advertising, a sales offer, spam or phishing.',
  other: 'None of the above.',
};

export const MAIL_PRIORITIES = ['high', 'normal', 'low'] as const;
export type MailPriority = (typeof MAIL_PRIORITIES)[number];

export const MAIL_PRIORITY_OPTIONS: Record<MailPriority, string> = {
  high: 'Needs attention today: a deadline, a problem, money at stake, an important person waiting.',
  normal: 'Should be handled in the next days.',
  low: 'Can wait or needs no action at all.',
};

export interface MailProjectOption {
  key: string;
  name: string;
  description?: string | null;
}

export const NO_PROJECT = 'none';

export function projectOptionId(key: string): string {
  return `p:${key.toLowerCase()}`;
}

export function mailQuestions(projects: MailProjectOption[]) {
  const projectOptions: DecisionOption[] = [
    ...projects.map((project) => ({
      id: projectOptionId(project.key),
      label: `${project.name}${project.description?.trim() ? `: ${project.description.trim().slice(0, 300)}` : ''}`,
    })),
    { id: NO_PROJECT, label: 'None of these projects, or it is not clear which.' },
  ];
  return {
    project: {
      kind: 'choice',
      question: 'Which of these projects does this mail belong to?',
      options: projectOptions,
    },
    category: {
      kind: 'choice',
      question: 'What kind of mail is this?',
      options: MAIL_CATEGORIES.map((id) => ({ id, label: MAIL_CATEGORY_OPTIONS[id] })),
    },
    priority: {
      kind: 'choice',
      question: 'How urgent is this mail for its recipient?',
      options: MAIL_PRIORITIES.map((id) => ({ id, label: MAIL_PRIORITY_OPTIONS[id] })),
    },
    needs_reply: {
      kind: 'yesno',
      question: 'Does this mail expect a written reply from its recipient?',
    },
    create_task: {
      kind: 'yesno',
      question:
        'Does this mail ask its recipient to do something beyond replying (pay, deliver, ' +
        'prepare, check, sign, book, fix)?',
    },
  } satisfies Record<string, DecisionQuestion>;
}

// The mail as the classifier reads it: sender, subject, and the start of the text.
export function mailContext(mail: {
  fromName: string;
  fromAddress: string;
  to?: string;
  subject: string;
  text: string;
  attachments?: string[];
}): string {
  const lines = [
    `From: ${mail.fromName ? `${mail.fromName} <${mail.fromAddress}>` : mail.fromAddress}`,
    ...(mail.to ? [`To: ${mail.to}`] : []),
    `Subject: ${mail.subject}`,
    ...(mail.attachments?.length ? [`Attachments: ${mail.attachments.join(', ')}`] : []),
    '',
    mail.text
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, 3000),
  ];
  return lines.join('\n');
}

// ── Receipt matching ──────────────────────────────────────────────────────────────────────

export const NO_TRANSACTION = 'none';

export interface ReceiptCandidate {
  id: number;
  bookingDate: string;
  amount: string;
  currency: string;
  counterpartyName: string;
  counterpartyIban?: string | null;
  purpose: string;
}

export function transactionOptionId(id: number): string {
  return `t:${id}`;
}

export function receiptQuestions(candidates: ReceiptCandidate[]) {
  return {
    match: {
      kind: 'choice',
      question:
        'Which bank transaction pays (or is the payment of) this receipt? Compare the amount, ' +
        'the payee or payer, the invoice number in the purpose and the dates.',
      options: [
        ...candidates.map((candidate) => ({
          id: transactionOptionId(candidate.id),
          label:
            `${candidate.bookingDate}, ${candidate.amount} ${candidate.currency}, ` +
            `${candidate.counterpartyName || '(no name)'}` +
            `${candidate.counterpartyIban ? ` (${candidate.counterpartyIban})` : ''}` +
            ` — ${candidate.purpose.replace(/\s+/g, ' ').slice(0, 200)}`,
        })),
        { id: NO_TRANSACTION, label: 'None of these transactions belongs to this receipt.' },
      ],
    },
  } satisfies Record<string, DecisionQuestion>;
}

export function receiptContext(receipt: {
  issuer?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  dueDate?: string | null;
  totalGross?: string | null;
  currency?: string | null;
  iban?: string | null;
  direction?: 'incoming' | 'outgoing';
  filename: string;
  text?: string | null;
}): string {
  const lines = [
    `Receipt: ${receipt.filename}`,
    `Direction: ${receipt.direction === 'outgoing' ? 'invoice we wrote (money comes in)' : 'bill we pay (money goes out)'}`,
    ...(receipt.issuer ? [`Issuer: ${receipt.issuer}`] : []),
    ...(receipt.invoiceNumber ? [`Invoice number: ${receipt.invoiceNumber}`] : []),
    ...(receipt.invoiceDate ? [`Invoice date: ${receipt.invoiceDate}`] : []),
    ...(receipt.dueDate ? [`Due: ${receipt.dueDate}`] : []),
    ...(receipt.totalGross ? [`Total: ${receipt.totalGross} ${receipt.currency ?? 'EUR'}`] : []),
    ...(receipt.iban ? [`Payee IBAN: ${receipt.iban}`] : []),
    ...(receipt.text ? ['', receipt.text.replace(/\s+\n/g, '\n').trim().slice(0, 2500)] : []),
  ];
  return lines.join('\n');
}
