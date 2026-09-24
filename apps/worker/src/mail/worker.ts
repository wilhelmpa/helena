import { storageConfigured } from '@repo/storage';
import { startPollLoop, type WorkerHandle } from '../poll-loop';
import { AccountSync } from './account-sync';
import { applyApprovalDecisions, sendDueDrafts } from './send';
import { accountsWithPendingActions, loadSyncAccounts } from './store';
import { mailSyncConfig } from './transport';

// Keeps one AccountSync per enabled account with a password and restarts it when the
// owner edits the account. Every tick it also sends the drafts that are due and wakes
// the accounts with changes to push.
export function startMailWorker(): WorkerHandle {
  if (!storageConfigured()) {
    console.log('[mail] file storage is not configured; mail is not imported or sent');
    return { stop() {} };
  }
  const syncs = new Map<number, AccountSync>();
  const config = mailSyncConfig();

  async function tick(): Promise<void> {
    const accounts = await loadSyncAccounts();
    const wanted = new Map(accounts.map((account) => [account.id, account]));
    for (const [id, sync] of syncs) {
      const account = wanted.get(id);
      if (account && account.version === sync.account.version) continue;
      syncs.delete(id);
      await sync.stop();
    }
    for (const account of accounts) {
      if (syncs.has(account.id)) continue;
      const sync = new AccountSync(account, config);
      syncs.set(account.id, sync);
      sync.start();
    }
    await applyApprovalDecisions();
    await sendDueDrafts();
    for (const id of await accountsWithPendingActions()) syncs.get(id)?.wake();
  }

  const loop = startPollLoop('mail', tick, () => 3000);
  return {
    stop() {
      loop.stop();
      for (const sync of syncs.values()) void sync.stop();
    },
  };
}
