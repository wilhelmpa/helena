import { createImapClient, sendRawMail, type ImapFlow, type MailServerSettings } from '@repo/mail';
import { intEnv } from '../env';

// The part of ImapFlow the importer uses. Tests replace the factory with an
// in-memory server of the same shape.
export type ImapClient = Pick<
  ImapFlow,
  | 'connect'
  | 'logout'
  | 'close'
  | 'list'
  | 'getMailboxLock'
  | 'mailboxOpen'
  | 'mailboxCreate'
  | 'search'
  | 'fetchAll'
  | 'messageFlagsAdd'
  | 'messageFlagsRemove'
  | 'messageMove'
  | 'append'
  | 'on'
  | 'off'
  | 'mailbox'
  | 'usable'
  | 'enabled'
>;

export interface MailTransport {
  imap(settings: MailServerSettings): ImapClient;
  send(
    settings: MailServerSettings,
    envelope: { from: string; to: string[] },
    raw: Buffer,
  ): Promise<void>;
}

const defaultTransport: MailTransport = { imap: createImapClient, send: sendRawMail };
let current = defaultTransport;

export function mailTransport(): MailTransport {
  return current;
}

export function setMailTransportForTests(transport: MailTransport | null): void {
  current = transport ?? defaultTransport;
}

export interface MailSyncConfig {
  // How often the folders other than the inbox are compared with the server.
  pollIntervalMs: number;
  // Messages downloaded per batch of a first import, and the pause after each batch.
  batchSize: number;
  batchBytes: number;
  pauseMs: number;
  // First wait after a failed connection; doubled up to maxBackoffMs.
  backoffMs: number;
  maxBackoffMs: number;
}

export function mailSyncConfig(): MailSyncConfig {
  return {
    pollIntervalMs: intEnv('MAIL_POLL_INTERVAL_MS', 300_000),
    batchSize: intEnv('MAIL_IMPORT_BATCH_SIZE', 20),
    batchBytes: intEnv('MAIL_IMPORT_BATCH_BYTES', 8 * 1024 * 1024),
    pauseMs: intEnv('MAIL_IMPORT_PAUSE_MS', 250),
    backoffMs: intEnv('MAIL_RETRY_MS', 30_000),
    maxBackoffMs: intEnv('MAIL_MAX_RETRY_MS', 600_000),
  };
}
