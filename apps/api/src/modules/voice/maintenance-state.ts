import { randomUUID } from 'node:crypto';
import { lstat, unlink, writeFile } from 'node:fs/promises';

const REQUESTS = '/var/lib/helena-updates/spool/voice-requests';

export async function voiceMaintenanceHeld(): Promise<boolean> {
  return lstat('/var/lib/helena-updates/voice-maintenance.json')
    .then(() => true)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return false;
      throw error;
    });
}

export async function registerTranscription(): Promise<() => Promise<void>> {
  const directory = await lstat(REQUESTS).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  // Without the native directory the privileged updater cannot advertise its capability.
  if (!directory) return async () => {};
  if (!directory.isDirectory() || directory.isSymbolicLink())
    throw new Error('The voice admission directory is invalid');
  const path = `${REQUESTS}/${randomUUID()}.json`;
  await writeFile(path, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), {
    flag: 'wx',
    mode: 0o600,
  });
  return () => unlink(path);
}
