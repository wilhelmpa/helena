import { request } from '@/lib/api/core/client';

// The mail classifier in the inbox (apps/api/src/modules/mail-triage,
// docs/helena-decisions/decisions.md §5).

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

export const MAIL_PRIORITIES = ['high', 'normal', 'low'] as const;
export type MailPriority = (typeof MAIL_PRIORITIES)[number];

export interface MailTriageBadge {
  status: string;
  category: string | null;
  priority: string | null;
  needsReply: boolean | null;
}

export interface MailClassification extends MailTriageBadge {
  id: number;
  threadId: number;
  messageId: number;
  projectId: number | null;
  projectKey: string | null;
  createTask: boolean | null;
  answers: Record<string, { choice: string | null; confidence: number | null; decided: boolean }>;
  actions: {
    kind: string;
    projectId?: number | null;
    issueId?: number | null;
    agentId?: number | null;
    receiptIds?: number[];
    note?: string | null;
  }[];
  issueId: number | null;
  error: string | null;
  corrected: boolean;
  createdAt: string;
}

export const getMailClassification = (threadId: number) =>
  request<{ classification: MailClassification | null }>(
    `/mail/threads/${threadId}/classification`,
  );

export const classifyMailThread = (threadId: number) =>
  request<{ classification: MailClassification | null }>(
    `/mail/threads/${threadId}/classification`,
    { method: 'POST' },
  );

export const correctMailClassification = (
  threadId: number,
  body: { category?: string; priority?: string; projectId?: number | null; needsReply?: boolean },
) =>
  request<MailClassification>(`/mail/threads/${threadId}/classification`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });

export const acceptMailSuggestion = (threadId: number, kind: 'task' | 'agent') =>
  request<MailClassification>(`/mail/threads/${threadId}/classification/accept`, {
    method: 'POST',
    body: JSON.stringify({ kind }),
  });
