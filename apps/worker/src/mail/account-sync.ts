import { connectionError, folderPriority, folderRole, isSkippedFolder } from '@repo/mail';
import { pushActions } from './actions';
import { syncFolder, type FolderSyncOptions } from './folder-sync';
import {
  saveFolders,
  setAccountStatus,
  syncedFolders,
  type FolderRow,
  type SyncAccount,
} from './store';
import { mailTransport, type ImapClient, type MailSyncConfig } from './transport';

const INBOX_REFRESH_MS = 60_000;

// One IMAP connection per account. It imports every folder, then waits on the inbox
// (IDLE) for new mail and compares the other folders with the server every
// pollIntervalMs. Changes made in Plan are pushed before each pass and between the
// batches of a long import.
export class AccountSync {
  private stopped = false;
  private client: ImapClient | null = null;
  private wakeUp: (() => void) | null = null;
  private woken = false;
  private done: Promise<void> = Promise.resolve();

  constructor(
    readonly account: SyncAccount,
    private readonly config: MailSyncConfig,
  ) {}

  start(): void {
    this.done = this.run();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.wakeUp?.();
    this.client?.close();
    await this.done;
  }

  wake(): void {
    this.woken = true;
    this.wakeUp?.();
  }

  private async run(): Promise<void> {
    let backoff = this.config.backoffMs;
    while (!this.stopped) {
      const client = mailTransport().imap(this.account.settings);
      this.client = client;
      client.on('error', () => undefined);
      try {
        await client.connect();
        backoff = this.config.backoffMs;
        await this.session(client);
      } catch (error) {
        if (this.stopped) break;
        const message = connectionError(error);
        console.error(`[mail] account ${this.account.id}: ${message}`);
        await setAccountStatus(this.account.id, 'error', message).catch(() => undefined);
        await this.pause(backoff);
        backoff = Math.min(backoff * 2, this.config.maxBackoffMs);
      } finally {
        client.close();
        this.client = null;
      }
    }
  }

  private async session(client: ImapClient): Promise<void> {
    let nextFullPass = 0;
    while (!this.stopped) {
      this.woken = false;
      await pushActions(client, this.account.id);
      if (Date.now() >= nextFullPass) {
        await this.fullPass(client);
        nextFullPass = Date.now() + this.config.pollIntervalMs;
      } else {
        await this.syncInbox(client);
      }
      if (!client.usable) throw new Error('Connection closed');
      await this.waitForChange(client, nextFullPass - Date.now());
    }
  }

  async fullPass(client: ImapClient): Promise<void> {
    const listed = await client.list();
    const folders = await saveFolders(
      this.account.id,
      listed.map((folder) => ({
        path: folder.path,
        name: folder.name,
        role: folderRole(folder.path, folder.specialUse),
        sync: !isSkippedFolder(folder, this.account),
      })),
    );
    const synced = folders
      .filter((folder) => folder.sync)
      .sort((left, right) => folderPriority(left.role) - folderPriority(right.role));
    const firstImport = synced.some((folder) => folder.lastSyncedAt == null);
    if (firstImport) await setAccountStatus(this.account.id, 'importing');
    let lastInbox = Date.now();
    const options = (folder: FolderRow): FolderSyncOptions => ({
      config: this.config,
      stopped: () => this.stopped,
      between: async () => {
        await pushActions(client, this.account.id);
        if (folder.role !== 'inbox' && Date.now() - lastInbox > INBOX_REFRESH_MS) {
          lastInbox = Date.now();
          await this.syncInbox(client);
        }
      },
    });
    for (const folder of synced) {
      if (this.stopped) return;
      await syncFolder(client, this.account, folder, options(folder));
    }
    await setAccountStatus(this.account.id, 'synced');
  }

  private async syncInbox(client: ImapClient): Promise<void> {
    const inbox = (await syncedFolders(this.account.id)).find((folder) => folder.role === 'inbox');
    if (!inbox) return;
    await syncFolder(client, this.account, inbox, {
      config: this.config,
      stopped: () => this.stopped,
      between: () => pushActions(client, this.account.id),
    });
  }

  // Waits with the inbox selected, so the server reports new mail over IDLE, until
  // the inbox changes, the next full pass is due or wake() is called.
  private async waitForChange(client: ImapClient, ms: number): Promise<void> {
    if (this.woken || this.stopped) return;
    await client.mailboxOpen('INBOX');
    await new Promise<void>((resolve) => {
      const events = ['exists', 'expunge', 'flags', 'close'] as const;
      const finish = () => {
        clearTimeout(timer);
        for (const event of events) client.off(event, finish);
        this.wakeUp = null;
        resolve();
      };
      const timer = setTimeout(finish, Math.max(ms, 1000));
      for (const event of events) client.on(event, finish);
      this.wakeUp = finish;
      if (this.woken || this.stopped) finish();
    });
  }

  private pause(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(finish, ms);
      function finish() {
        clearTimeout(timer);
        resolve();
      }
      this.wakeUp = () => {
        if (this.stopped) finish();
      };
    });
  }
}
