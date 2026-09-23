import { db, mailFolder } from '@repo/db';
import { connectionError, type FolderRole } from '@repo/mail';
import { eq } from 'drizzle-orm';
import { failAction, finishAction, pendingActions, type ActionRow } from './store';
import type { ImapClient } from './transport';

const FLAGS: Record<string, { add: boolean; flag: string }> = {
  seen: { add: true, flag: '\\Seen' },
  unseen: { add: false, flag: '\\Seen' },
  flag: { add: true, flag: '\\Flagged' },
  unflag: { add: false, flag: '\\Flagged' },
};

// Where archive and delete move a message. Gmail has no Archive folder: a message
// moved to All Mail loses the inbox label, which is what archiving means there. A
// server with neither gets an "Archive" (or "Trash") folder.
async function targetPath(
  client: ImapClient,
  accountId: number,
  kind: 'archive' | 'trash',
): Promise<string> {
  const folders = await db
    .select({ path: mailFolder.path, role: mailFolder.role })
    .from(mailFolder)
    .where(eq(mailFolder.accountId, accountId));
  const roles: FolderRole[] = kind === 'archive' ? ['archive', 'all'] : ['trash'];
  for (const role of roles) {
    const found = folders.find((folder) => folder.role === role);
    if (found) return found.path;
  }
  const created = await client.mailboxCreate(kind === 'archive' ? 'Archive' : 'Trash');
  return created.path;
}

// Pushes the changes made in Plan to the server, folder by folder.
export async function pushActions(client: ImapClient, accountId: number): Promise<void> {
  const actions = await pendingActions(accountId);
  if (actions.length === 0) return;
  const folders = await db
    .select({ id: mailFolder.id, path: mailFolder.path })
    .from(mailFolder)
    .where(eq(mailFolder.accountId, accountId));
  const byFolder = new Map<number, ActionRow[]>();
  for (const action of actions) {
    byFolder.set(action.folderId, [...(byFolder.get(action.folderId) ?? []), action]);
  }
  for (const [folderId, folderActions] of byFolder) {
    const path = folders.find((folder) => folder.id === folderId)?.path;
    if (!path) continue;
    const targets = new Map<string, string>();
    for (const action of folderActions) {
      if (action.kind === 'archive' || action.kind === 'trash') {
        if (!targets.has(action.kind))
          targets.set(action.kind, await targetPath(client, accountId, action.kind));
      }
    }
    const lock = await client.getMailboxLock(path);
    try {
      for (const action of folderActions) {
        try {
          await applyAction(client, action, path, targets);
          await finishAction(action.id);
        } catch (error) {
          await failAction(action.id, connectionError(error));
        }
      }
    } finally {
      lock.release();
    }
  }
}

async function applyAction(
  client: ImapClient,
  action: ActionRow,
  path: string,
  targets: Map<string, string>,
): Promise<void> {
  const range = String(action.uid);
  const flag = FLAGS[action.kind];
  if (flag) {
    if (flag.add) await client.messageFlagsAdd(range, [flag.flag], { uid: true });
    else await client.messageFlagsRemove(range, [flag.flag], { uid: true });
    return;
  }
  const target = targets.get(action.kind);
  if (target && target !== path) await client.messageMove(range, target, { uid: true });
}
