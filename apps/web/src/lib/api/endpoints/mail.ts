import type { MailTriageBadge } from '@/lib/api/endpoints/mailTriage';
import { API_URL, request, uploadFile } from '@/lib/api/core/client';

export interface MailAddress {
  name: string;
  address: string;
}

export type MailSyncStatus = 'idle' | 'importing' | 'synced' | 'error';

export interface MailAccount {
  id: number;
  teamId: number;
  projectId: number | null;
  projectKey: string | null;
  projectName: string | null;
  name: string;
  address: string;
  imapHost: string;
  imapPort: number;
  imapTls: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpTls: boolean;
  username: string;
  hasPassword: boolean;
  // 'xoauth2': the Mail service of a Google account (googleAccountId), which signs in
  // with the account's token; its servers and login come from the account.
  auth: 'password' | 'xoauth2';
  googleAccountId: number | null;
  // Only mail of the last fetchDays days is imported; null imports everything.
  fetchDays: number | null;
  resetPending: boolean;
  // The secret of the Credentials page that holds the password.
  credentialId: number | null;
  credentialLabel: string | null;
  enabled: boolean;
  syncTrash: boolean;
  syncSpam: boolean;
  syncStatus: MailSyncStatus;
  syncError: string | null;
  lastSyncAt: string | null;
  progress: { synced: number; total: number };
}

export interface MailServerInput {
  imapHost: string;
  imapPort: number;
  imapTls: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpTls: boolean;
  username: string;
}

export interface MailAccountInput extends MailServerInput {
  name: string;
  address: string;
  projectId: number | null;
  // A typed password becomes a new secret of the Credentials page; credentialId picks one.
  password?: string;
  credentialId?: number;
  enabled?: boolean;
  syncTrash?: boolean;
  syncSpam?: boolean;
  fetchDays?: number | null;
}

export type MailRuleMatch = 'address' | 'domain';

export interface MailRule {
  id: number;
  accountId: number | null;
  matchType: MailRuleMatch;
  value: string;
  projectId: number;
  projectKey: string;
  projectName: string;
}

export type MailFolderRole = 'inbox' | 'sent' | 'drafts' | 'archive' | 'trash' | 'junk' | 'all';

export interface MailFolder {
  id: number;
  accountId: number;
  path: string;
  name: string;
  role: string | null;
}

export interface MailThreadRow {
  id: number;
  accountId: number;
  accountAddress: string;
  accountName: string;
  projectId: number | null;
  projectKey: string | null;
  suggestedProjectId: number | null;
  suggestedProjectKey: string | null;
  subject: string;
  lastMessageAt: string;
  fromName: string;
  fromAddress: string;
  snippet: string;
  messageCount: number;
  unread: boolean;
  flagged: boolean;
  hasAttachments: boolean;
  // What the mail classifier made of it (docs/helena-decisions/decisions.md §5).
  triage?: MailTriageBadge | null;
}

export interface MailThreadPage {
  items: MailThreadRow[];
  nextCursor: string | null;
}

export interface MailThreadFilters {
  projectId?: number;
  home?: boolean;
  accountId?: number;
  folderId?: number;
  role?: MailFolderRole;
  unread?: boolean;
  attachments?: boolean;
  q?: string;
}

export interface MailMessageAttachment {
  id: number;
  filename: string;
  contentType: string;
  size: number;
  vaultPath: string;
}

export interface MailMessage {
  id: number;
  messageId: string;
  subject: string;
  fromName: string;
  fromAddress: string;
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  replyTo: MailAddress[];
  sentAt: string;
  text: string;
  html: string | null;
  hasRemoteImages: boolean;
  allowRemoteImages: boolean;
  seen: boolean;
  flagged: boolean;
  folders: string[];
  attachments: MailMessageAttachment[];
}

export interface MailThread {
  id: number;
  teamId: number;
  subject: string;
  projectId: number | null;
  projectKey: string | null;
  projectName: string | null;
  suggestedProjectId: number | null;
  suggestedProjectKey: string | null;
  suggestedProjectName: string | null;
  accountId: number;
  accountName: string;
  accountAddress: string;
  issues: {
    id: number;
    identifier: string;
    title: string;
    projectKey: string;
    sequenceNumber: number;
  }[];
  drafts: {
    id: number;
    status: 'draft' | 'pending_approval' | 'failed' | 'queued';
    subject: string;
    updatedAt: string;
    createdByName: string | null;
  }[];
  messages: MailMessage[];
}

export type MailThreadAction = 'read' | 'unread' | 'flag' | 'unflag' | 'archive' | 'trash';

export type MailDraftMode = 'new' | 'reply' | 'reply_all' | 'forward';
export type MailDraftStatus =
  'draft' | 'pending_approval' | 'queued' | 'sending' | 'sent' | 'failed';

export interface MailDraftAttachment {
  source: 'storage' | 'vault';
  ref: string;
  filename: string;
  contentType: string;
  size: number;
}

export interface MailDraft {
  id: number;
  teamId: number;
  accountId: number;
  accountAddress: string;
  threadId: number | null;
  replyToMessageId: number | null;
  issueId: number | null;
  mode: MailDraftMode;
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  subject: string;
  bodyText: string;
  bodyHtml: string;
  attachments: MailDraftAttachment[];
  status: MailDraftStatus;
  sendAt: string | null;
  lastError: string | null;
  createdByUserId: string | null;
  createdByName: string | null;
  approvalRequestId: number | null;
  updatedAt: string;
}

export interface MailDraftPatch {
  accountId?: number;
  to?: MailAddress[];
  cc?: MailAddress[];
  bcc?: MailAddress[];
  subject?: string;
  bodyText?: string;
  bodyHtml?: string;
  attachments?: { source: 'storage' | 'vault'; ref: string }[];
}

export interface IssueMailThread {
  id: number;
  subject: string;
  lastMessageAt: string;
  fromName: string;
  fromAddress: string;
  snippet: string;
  accountAddress: string;
  latestMessageId: number | null;
}

const json = (body: unknown) => ({ body: JSON.stringify(body) });

export const listMailAccounts = (teamId: number) =>
  request<MailAccount[]>(`/teams/${teamId}/mail/accounts`);

export const listProjectMailAccounts = (projectKey: string) =>
  request<MailAccount[]>(`/projects/${encodeURIComponent(projectKey)}/mail/accounts`);

export const createMailAccount = (teamId: number, input: MailAccountInput) =>
  request<MailAccount>(`/teams/${teamId}/mail/accounts`, { method: 'POST', ...json(input) });

export const updateMailAccount = (
  teamId: number,
  accountId: number,
  input: Partial<MailAccountInput>,
) =>
  request<MailAccount>(`/teams/${teamId}/mail/accounts/${accountId}`, {
    method: 'PATCH',
    ...json(input),
  });

export const deleteMailAccount = (teamId: number, accountId: number) =>
  request<void>(`/teams/${teamId}/mail/accounts/${accountId}`, { method: 'DELETE' });

// Wipes the imported copies of the account; the worker imports again.
export const resetMailAccount = (teamId: number, accountId: number) =>
  request<MailAccount>(`/teams/${teamId}/mail/accounts/${accountId}/reset`, { method: 'POST' });

export const testMailConnection = (
  teamId: number,
  input: MailServerInput & { password?: string; credentialId?: number; accountId?: number },
) =>
  request<{ imap: string | null; smtp: string | null }>(`/teams/${teamId}/mail/accounts/test`, {
    method: 'POST',
    ...json(input),
  });

export const listMailRules = (teamId: number) => request<MailRule[]>(`/teams/${teamId}/mail/rules`);

export const createMailRule = (
  teamId: number,
  input: {
    accountId: number | null;
    matchType: MailRuleMatch;
    value: string;
    projectId: number;
    applyToExisting: boolean;
  },
) =>
  request<{ rule: MailRule; movedThreads: number }>(`/teams/${teamId}/mail/rules`, {
    method: 'POST',
    ...json(input),
  });

export const deleteMailRule = (teamId: number, ruleId: number) =>
  request<void>(`/teams/${teamId}/mail/rules/${ruleId}`, { method: 'DELETE' });

export function listMailThreads(
  teamId: number,
  filters: MailThreadFilters,
  cursor: string | null,
): Promise<MailThreadPage> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === false || value === '') continue;
    params.set(key, String(value));
  }
  if (cursor) params.set('cursor', cursor);
  params.set('limit', '50');
  return request(`/teams/${teamId}/mail/threads?${params}`);
}

export const listMailFolders = (teamId: number, accountId?: number) =>
  request<MailFolder[]>(
    `/teams/${teamId}/mail/folders${accountId ? `?accountId=${accountId}` : ''}`,
  );

export const searchMailContacts = (teamId: number, q: string) =>
  request<MailAddress[]>(`/teams/${teamId}/mail/contacts?q=${encodeURIComponent(q)}`);

export const getMailThread = (threadId: number) => request<MailThread>(`/mail/threads/${threadId}`);

export const moveMailThread = (threadId: number, projectId: number | null) =>
  request<void>(`/mail/threads/${threadId}`, { method: 'PATCH', ...json({ projectId }) });

export const mailThreadAction = (threadId: number, action: MailThreadAction) =>
  request<void>(`/mail/threads/${threadId}/actions`, { method: 'POST', ...json({ action }) });

export const createTaskFromMail = (threadId: number, projectId?: number) =>
  request<{ issueId: number; sequenceNumber: number; projectKey: string }>(
    `/mail/threads/${threadId}/task`,
    { method: 'POST', ...json(projectId ? { projectId } : {}) },
  );

export const saveMailNote = (threadId: number) =>
  request<{ path: string; projectKey: string | null }>(`/mail/threads/${threadId}/note`, {
    method: 'POST',
  });

export const setRemoteImages = (messageId: number, allow: boolean) =>
  request<void>(`/mail/messages/${messageId}/remote-images`, {
    method: 'POST',
    ...json({ allow }),
  });

export const mailAttachmentUrl = (attachmentId: number) =>
  `${API_URL}/mail/attachments/${attachmentId}`;

// The base the HTML of a message resolves its inline images against.
export const mailApiBase = () => `${API_URL}/`;

export const listIssueMailThreads = (issueId: number) =>
  request<IssueMailThread[]>(`/issues/${issueId}/mail-threads`);

export const listMailDrafts = (teamId: number) =>
  request<MailDraft[]>(`/teams/${teamId}/mail/drafts`);

export const createMailDraft = (
  teamId: number,
  input: {
    mode: MailDraftMode;
    accountId?: number;
    messageId?: number;
    issueId?: number;
    to?: MailAddress[];
  },
) => request<MailDraft>(`/teams/${teamId}/mail/drafts`, { method: 'POST', ...json(input) });

export const getMailDraft = (draftId: number) => request<MailDraft>(`/mail/drafts/${draftId}`);

export const updateMailDraft = (draftId: number, patch: MailDraftPatch) =>
  request<MailDraft>(`/mail/drafts/${draftId}`, { method: 'PATCH', ...json(patch) });

export const deleteMailDraft = (draftId: number) =>
  request<void>(`/mail/drafts/${draftId}`, { method: 'DELETE' });

export const uploadMailDraftFile = (draftId: number, file: File) =>
  uploadFile<MailDraft>(`/mail/drafts/${draftId}/attachments`, 'POST', file);

export const attachVaultFileToDraft = (draftId: number, path: string) =>
  request<MailDraft>(`/mail/drafts/${draftId}/vault-attachments`, {
    method: 'POST',
    ...json({ path }),
  });

export const sendMailDraft = (draftId: number) =>
  request<MailDraft>(`/mail/drafts/${draftId}/send`, { method: 'POST' });

export const undoMailDraft = (draftId: number) =>
  request<MailDraft>(`/mail/drafts/${draftId}/undo`, { method: 'POST' });
