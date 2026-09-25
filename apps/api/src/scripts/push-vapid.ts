// The instance's VAPID key pair for Web Push (docs/helena-decisions/push.md). Helena creates
// it by itself on first use; this makes that step explicit after a deploy and is the one way
// to replace a leaked key. Run as the api's user with its environment (APP_ENCRYPTION_KEY and
// DATABASE_URL):
//
//   bun --env-file=<api env> src/scripts/push-vapid.ts            # check: is there a key?
//   bun --env-file=<api env> src/scripts/push-vapid.ts --init     # create it if missing
//   bun --env-file=<api env> src/scripts/push-vapid.ts --rotate --yes
//
// --rotate replaces the pair and removes every push subscription (only the old pair could push
// to them); each device subscribes anew the next time Helena opens there with push on.
// Prints the public key, its age and the number of devices, never the private key.

import { db, helenaPushSubscription, readRedactedSecret } from '@repo/db';
import { count } from 'drizzle-orm';
import { VAPID_SECRET_KEY, rotateVapidKeys, vapidKeys, vapidSubject } from '@helena/push';

const args = new Set(process.argv.slice(2));

async function show(prefix: string): Promise<void> {
  const redacted = await readRedactedSecret<{ publicKey: string; createdAt: string }>(
    VAPID_SECRET_KEY,
  );
  const [devices] = await db.select({ n: count() }).from(helenaPushSubscription);
  if (!redacted) {
    console.log(`${prefix}no VAPID key yet (Helena creates one on first use; --init does now)`);
  } else {
    console.log(`${prefix}public key ${redacted.publicKey}`);
    console.log(`${prefix}created ${redacted.createdAt}`);
  }
  console.log(`${prefix}subject ${await vapidSubject()}`);
  console.log(`${prefix}devices ${devices?.n ?? 0}`);
}

if (args.has('--rotate')) {
  if (!args.has('--yes')) {
    console.error('--rotate removes every push subscription; repeat with --yes to do it.');
    process.exit(2);
  }
  const removed = await rotateVapidKeys();
  console.log(`rotated; removed ${removed} subscriptions`);
  await show('');
} else if (args.has('--init')) {
  await vapidKeys();
  await show('');
} else {
  await show('');
}
process.exit(0);
