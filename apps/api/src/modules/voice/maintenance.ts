import { sql } from 'drizzle-orm';
import { db } from '@repo/db';
import { HttpError } from '#shared/lib';

import { registerTranscription, voiceMaintenanceHeld } from './maintenance-state';

export async function withTranscriptionAdmission<T>(work: () => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    const lock = await tx.execute(
      sql`select pg_try_advisory_xact_lock_shared(748220, 13306) as acquired`,
    );
    if (!lock[0]?.acquired)
      throw new HttpError(
        503,
        'Voice transcription is being updated. Try again shortly.',
        'voice-maintenance',
      );
    const complete = await registerTranscription();
    if (await voiceMaintenanceHeld()) {
      await complete();
      throw new HttpError(
        503,
        'Voice transcription is awaiting update recovery.',
        'voice-maintenance',
      );
    }
    // Completion belongs to the HTTP/body work, not to a DB transaction that can reject early.
    // Failed/aborted requests retain their token because transport failure does not prove GPU completion.
    const result = await work();
    await complete();
    return result;
  });
}
