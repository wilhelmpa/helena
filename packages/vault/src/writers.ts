import { readFileSync } from 'node:fs';
import type { Stats } from 'node:fs';

// Who wrote a change Helena found on disk. The notes (SilverBullet, deployment/volition-stack/
// native/notes) run as their own account and write each note as a new file renamed over the
// old one, so a file that account owns was last written in the notes, by the owner (they
// have no other user). Every other outside change stays "extern".
export const NOTES_ACCOUNT = 'helena-notes';

const NEGATIVE_TTL_MS = 60_000;
let cache: { uid: number | null; at: number } | null = null;

function lookupUid(account: string): number | null {
  const override = process.env.HELENA_NOTES_UID?.trim();
  if (override) return /^\d+$/.test(override) ? Number(override) : null;
  try {
    for (const line of readFileSync('/etc/passwd', 'utf8').split('\n')) {
      const [name, , uid] = line.split(':');
      if (name === account && uid && /^\d+$/.test(uid)) return Number(uid);
    }
  } catch {
    // No passwd database (a development machine): nobody is the notes.
  }
  return null;
}

// The notes account's uid, or null where it does not exist. Looked up again a minute after a
// miss, so a worker started before the notes were installed learns about them.
export function notesUid(): number | null {
  const now = Date.now();
  if (cache && (cache.uid !== null || now - cache.at < NEGATIVE_TTL_MS)) return cache.uid;
  cache = { uid: lookupUid(NOTES_ACCOUNT), at: now };
  return cache.uid;
}

export function resetNotesUidForTests(): void {
  cache = null;
}

// The notes' own last write: the file belongs to the notes account and was created by that
// write (SilverBullet renames a new file over the note, so its birth is its last change). A
// later edit in place by someone else (an agent's file tool) keeps the owner but not the
// birth, and stays "extern". Without a birth time (a file system without one) nothing is
// attributed to the notes.
const SAME_WRITE_MS = 2_000;

export function writtenByNotes(stats: Pick<Stats, 'uid' | 'birthtimeMs' | 'mtimeMs'>): boolean {
  const uid = notesUid();
  if (uid === null || stats.uid !== uid) return false;
  if (!stats.birthtimeMs || stats.birthtimeMs <= 0) return false;
  return Math.abs(stats.mtimeMs - stats.birthtimeMs) <= SAME_WRITE_MS;
}
