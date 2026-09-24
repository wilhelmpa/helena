import { Elysia } from 'elysia';
import { authContext } from '#shared/auth-context';
import { requireGod, type AuthUser } from '#shared/access';
import { HttpError } from '#shared/lib';
import { commonErrors, errors } from '#shared/responses';
import { requireInteractiveOwner } from '#modules/connections/interactive';
import { HostdError, hostd } from './hostd';
import {
  HostReading,
  PasswordResponse,
  ServerOverviewResponse,
  arrayParams,
  backupRunBody,
  backupSettingsBody,
  diskParams,
  fansBody,
  freshQuery,
  guardBody,
  listQuery,
  profileBody,
  restoreBody,
  restoreParams,
  seenBody,
  snapshotParams,
  targetBody,
  targetParams,
} from './model';
import {
  backupStatus,
  hostEvents,
  invalidate,
  powerStatus,
  serverOverview,
  storageStatus,
  systemStatus,
} from './service';

// Administrator → Server (docs/helena-decisions/server-admin.md): the machine Helena runs
// on — disks and RAID, backups, power and fans — through the host helper. Reading is the
// instance owner's; every change needs his interactive session in the app (never an API
// key, never an agent), because it acts as root on the machine.

const READ_ERRORS = { ...errors(401, 403, 502, 503, 504) };
const WRITE_ERRORS = { ...commonErrors, ...errors(409, 502, 503, 504) };

// The helper's errors as HTTP answers. Its messages are short English sentences without
// paths or secrets, written for this.
function asHttp(error: unknown): never {
  if (error instanceof HostdError) {
    const status =
      error.code === 'Unavailable'
        ? 503
        : error.code === 'Timeout'
          ? 504
          : error.code === 'InvalidParameter'
            ? 400
            : error.code === 'NotFound'
              ? 404
              : ['NotAllowed', 'Busy', 'NotAvailable', 'NotSupported'].includes(error.code)
                ? 409
                : 502;
    throw new HttpError(status, error.message, `host_${error.code}`);
  }
  throw error;
}

async function call<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    asHttp(error);
  }
}

function actorOf(user: AuthUser): string {
  return (user.email ?? user.id).slice(0, 128);
}

async function owner(user: AuthUser | null | undefined, request: Request): Promise<AuthUser> {
  const current = requireGod(user);
  await requireInteractiveOwner(request, current.id);
  return current;
}

function remoteTargetsEnabled(): boolean {
  return process.env.HELENA_BACKUP_REMOTE === '1';
}

export const serverRoutes = new Elysia({ name: 'server', detail: { tags: ['Server'] } })
  .use(authContext)

  // ── Reading ───────────────────────────────────────────────────────────────────────────
  .get(
    '/god/server',
    async ({ user }) => {
      requireGod(user);
      return serverOverview();
    },
    {
      response: { 200: ServerOverviewResponse, ...errors(401, 403) },
      detail: {
        summary: 'Read what the host offers and how it is',
        description:
          'Every host capability (the built-in disks/RAID, backup, power and fans, and those ' +
          'of plugins), whether this host has it, and its health lines. Without the host ' +
          'helper (a container) the built-in ones are unavailable and the area is hidden.',
      },
    },
  )
  .get(
    '/god/server/system',
    async ({ user, query }) => {
      requireGod(user);
      return call(() => systemStatus(query.fresh === true));
    },
    {
      query: freshQuery,
      response: { 200: HostReading, ...READ_ERRORS },
      detail: {
        summary: 'Read the machine: board, CPU, uptime, memory and the GPU share of it',
      },
    },
  )
  .get(
    '/god/server/disks',
    async ({ user, query }) => {
      requireGod(user);
      return call(async () => ({
        storage: await storageStatus(query.fresh === true),
        events: await hostEvents(query.fresh === true).catch(() => null),
      }));
    },
    {
      query: freshQuery,
      response: { 200: HostReading, ...READ_ERRORS },
      detail: {
        summary:
          'Read the RAID arrays, the disks with their SMART health, the ESPs and boot entries',
      },
    },
  )
  .get(
    '/god/server/power',
    async ({ user, query }) => {
      requireGod(user);
      return call(() => powerStatus(query.fresh === true));
    },
    {
      query: freshQuery,
      response: { 200: HostReading, ...READ_ERRORS },
      detail: {
        summary: 'Read the power profile (EC, OS, ryzenadj), the fans and the temperatures',
      },
    },
  )
  .get(
    '/god/server/backup',
    async ({ user, query, set }) => {
      requireGod(user);
      set.headers['Cache-Control'] = 'private, no-store';
      return call(async () => ({
        ...(await backupStatus(query.fresh === true)),
        remoteTargets: remoteTargetsEnabled(),
      }));
    },
    {
      query: freshQuery,
      response: { 200: HostReading, ...READ_ERRORS },
      detail: {
        summary: 'Read the backup: schedule, retention, the last runs, restores and targets',
      },
    },
  )
  .get(
    '/god/server/backup/snapshots',
    async ({ user }) => {
      requireGod(user);
      return call(() => hostd('BackupSnapshots', {}, 120_000));
    },
    {
      response: { 200: HostReading, ...READ_ERRORS },
      detail: { summary: 'List the snapshots of the backup, newest first' },
    },
  )
  .get(
    '/god/server/backup/snapshots/:snapshot/files',
    async ({ user, params, query }) => {
      requireGod(user);
      return call(() =>
        hostd('BackupList', { snapshot: params.snapshot, path: query.path }, 180_000),
      );
    },
    {
      params: snapshotParams,
      query: listQuery,
      response: { 200: HostReading, ...READ_ERRORS, ...errors(400, 404) },
      detail: { summary: 'List one folder of a snapshot (folders first, at most 2000 entries)' },
    },
  )
  .get(
    '/god/server/backup/restores/:id',
    async ({ user, params }) => {
      requireGod(user);
      return call(() => hostd('RestoreStatus', { id: params.id }));
    },
    {
      params: restoreParams,
      response: { 200: HostReading, ...READ_ERRORS, ...errors(400, 404) },
      detail: { summary: 'Read how a restore went and where it put the files' },
    },
  )
  .get(
    '/god/server/events',
    async ({ user }) => {
      requireGod(user);
      return call(() => hostEvents(true));
    },
    {
      response: { 200: HostReading, ...READ_ERRORS },
      detail: {
        summary: 'Read what mdadm, smartd, the thermal guard and the backups reported',
      },
    },
  )

  // ── Changing (the owner's interactive session only) ───────────────────────────────────
  .post(
    '/god/server/events/seen',
    async ({ user, request, body }) => {
      const current = await owner(user, request);
      const result = await call(() =>
        hostd('MarkEventsSeen', { upTo: body.upTo, actor: actorOf(current) }),
      );
      invalidate('events');
      return result;
    },
    {
      body: seenBody,
      response: { 200: HostReading, ...WRITE_ERRORS },
      detail: { summary: 'Mark the events up to an id as seen' },
    },
  )
  .post(
    '/god/server/disks/arrays/:array/check',
    async ({ user, request, params }) => {
      const current = await owner(user, request);
      const result = await call(() =>
        hostd('StartRaidCheck', { array: params.array, actor: actorOf(current) }),
      );
      invalidate('storage');
      return result;
    },
    {
      params: arrayParams,
      response: { 200: HostReading, ...WRITE_ERRORS },
      detail: {
        summary: 'Start a consistency check of an array',
        description:
          "The kernel's md check (what mdcheck runs monthly): reads both copies and counts " +
          'mismatches. Only on a healthy array that is idle.',
      },
    },
  )
  .delete(
    '/god/server/disks/arrays/:array/check',
    async ({ user, request, params }) => {
      const current = await owner(user, request);
      const result = await call(() =>
        hostd('StopRaidCheck', { array: params.array, actor: actorOf(current) }),
      );
      invalidate('storage');
      return result;
    },
    {
      params: arrayParams,
      response: { 200: HostReading, ...WRITE_ERRORS },
      detail: { summary: 'Stop a running consistency check (never a rebuild)' },
    },
  )
  .post(
    '/god/server/disks/:disk/self-test',
    async ({ user, request, params }) => {
      const current = await owner(user, request);
      const result = await call(() =>
        hostd('StartSelfTest', { disk: params.disk, actor: actorOf(current) }, 60_000),
      );
      invalidate('storage');
      return result;
    },
    {
      params: diskParams,
      response: { 200: HostReading, ...WRITE_ERRORS },
      detail: { summary: "Start a disk's short SMART self-test, where the disk offers one" },
    },
  )
  .post(
    '/god/server/disks/boot-reserve',
    async ({ user, request }) => {
      const current = await owner(user, request);
      const result = await call(() => hostd('SetBootNextReserve', { actor: actorOf(current) }));
      invalidate('storage');
      return result;
    },
    {
      response: { 200: HostReading, ...WRITE_ERRORS },
      detail: {
        summary: 'Boot the reserve disk once, at the next restart',
        description:
          'Sets the firmware\'s BootNext to the entry "Debian (Reserve)" (the second ' +
          "disk's ESP). The restart itself is the owner's; the boot after it uses the " +
          'normal order again.',
      },
    },
  )
  .delete(
    '/god/server/disks/boot-reserve',
    async ({ user, request }) => {
      const current = await owner(user, request);
      const result = await call(() => hostd('ClearBootNext', { actor: actorOf(current) }));
      invalidate('storage');
      return result;
    },
    {
      response: { 200: HostReading, ...WRITE_ERRORS },
      detail: { summary: 'Cancel a pending one-time boot of the reserve disk' },
    },
  )
  .put(
    '/god/server/power/profile',
    async ({ user, request, body }) => {
      const current = await owner(user, request);
      const result = await call(() =>
        hostd('SetPowerProfile', { profile: body.profile, actor: actorOf(current) }, 30_000),
      );
      invalidate('power');
      return result;
    },
    {
      body: profileBody,
      response: { 200: HostReading, ...WRITE_ERRORS },
      detail: {
        summary: 'Switch the power profile: Sparsam, Ausgewogen or Leistung',
        description:
          'Sets every layer together: the EC power mode (quiet/balanced/performance), the ' +
          'OS profile (power-profiles-daemon) and, where configured, ryzenadj limits below the ' +
          "EC mode's own. Answers what each layer took.",
      },
    },
  )
  .put(
    '/god/server/power/fans',
    async ({ user, request, body }) => {
      const current = await owner(user, request);
      const result = await call(() =>
        hostd('SetFans', {
          mode: body.mode,
          ...('level' in body ? { level: body.level } : {}),
          actor: actorOf(current),
        }),
      );
      invalidate('power');
      return result;
    },
    {
      body: fansBody,
      response: { 200: HostReading, ...WRITE_ERRORS },
      detail: {
        summary: 'Set all fans together: automatic, or fixed at level 1–5',
        description:
          'While the thermal guard holds the fans at 5 because the CPU is hot, a lower level ' +
          'is kept and applied once the CPU has cooled down.',
      },
    },
  )
  .put(
    '/god/server/power/guard',
    async ({ user, request, body }) => {
      const current = await owner(user, request);
      const result = await call(() =>
        hostd('SetGuard', { limit: body.limit, actor: actorOf(current) }),
      );
      invalidate('power');
      return result;
    },
    {
      body: guardBody,
      response: { 200: HostReading, ...WRITE_ERRORS },
      detail: { summary: 'Set the temperature at which the guard raises fixed fans to 5' },
    },
  )
  .post(
    '/god/server/backup/run',
    async ({ user, request, body }) => {
      const current = await owner(user, request);
      const result = await call(() =>
        hostd('RunBackup', { kind: body.kind, actor: actorOf(current) }),
      );
      invalidate('backup');
      return result;
    },
    {
      body: backupRunBody,
      response: { 200: HostReading, ...WRITE_ERRORS },
      detail: { summary: 'Start a backup, the weekly maintenance or a restore test now' },
    },
  )
  .put(
    '/god/server/backup/settings',
    async ({ user, request, body }) => {
      const current = await owner(user, request);
      const result = await call(() =>
        hostd('SetBackupSettings', { ...body, actor: actorOf(current) }, 60_000),
      );
      invalidate('backup');
      return result;
    },
    {
      body: backupSettingsBody,
      response: { 200: HostReading, ...WRITE_ERRORS },
      detail: {
        summary: 'Set when backups run and how many snapshots are kept',
        description:
          'The schedule becomes the systemd timer (hourly, every 6 hours or daily at a time, ' +
          'or off); retention keeps that many hourly, daily, weekly and monthly snapshots.',
      },
    },
  )
  .post(
    '/god/server/backup/restores',
    async ({ user, request, body }) => {
      const current = await owner(user, request);
      if (body.mode === 'original' && body.confirm !== body.path) {
        throw new HttpError(400, 'Restoring in place needs the path typed again', 'confirm');
      }
      const result = await call(() =>
        hostd('StartRestore', { ...body, actor: actorOf(current) }, 180_000),
      );
      invalidate('backup');
      return result;
    },
    {
      body: restoreBody,
      response: { 200: HostReading, ...WRITE_ERRORS },
      detail: {
        summary: 'Restore a file or folder from a snapshot',
        description:
          "`copy` (default) restores into a new folder: the owner's own files into " +
          '~/Wiederhergestellt/<time>, everything else into the root-only restore folder. ' +
          '`original` puts it back where it was, after moving what is there aside ' +
          '(<path>.vor-wiederherstellung-<time>); it needs the path typed again as `confirm`.',
      },
    },
  )
  .post(
    '/god/server/backup/password/reveal',
    async ({ user, request, set }) => {
      const current = await owner(user, request);
      set.headers['Cache-Control'] = 'private, no-store';
      return call(() =>
        hostd<{ password: string }>('RevealBackupPassword', {
          actor: actorOf(current),
        }),
      );
    },
    {
      response: { 200: PasswordResponse, ...WRITE_ERRORS },
      detail: {
        summary: 'Show the backup password, until the owner confirms he wrote it down',
        description:
          'Without this password the backup cannot be read, also not by Helena after a ' +
          'reinstall. After the confirmation it is never shown again (root can still read ' +
          'it on the machine).',
      },
    },
  )
  .post(
    '/god/server/backup/password/acknowledge',
    async ({ user, request }) => {
      const current = await owner(user, request);
      const result = await call(() =>
        hostd('AcknowledgeBackupPassword', { actor: actorOf(current) }),
      );
      invalidate('backup');
      return result;
    },
    {
      response: { 200: HostReading, ...WRITE_ERRORS },
      detail: { summary: 'Confirm the backup password is written down; it is not shown again' },
    },
  )
  .put(
    '/god/server/backup/targets/:id',
    async ({ user, request, params, body }) => {
      const current = await owner(user, request);
      if (!remoteTargetsEnabled()) throw new HttpError(404, 'Offsite targets are not enabled');
      const result = await call(() =>
        hostd('SetBackupTarget', {
          id: params.id,
          kind: 's3',
          repository: body.repository,
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
          ...(body.credentials ? { credentials: body.credentials } : {}),
          actor: actorOf(current),
        }),
      );
      invalidate('backup');
      return result;
    },
    {
      params: targetParams,
      body: targetBody,
      response: { 200: HostReading, ...WRITE_ERRORS },
      detail: {
        summary: 'Add or change an offsite target (S3), behind HELENA_BACKUP_REMOTE=1',
        description:
          'Every backup run copies its snapshot there (restic copy). The key goes to the ' +
          "host helper, which keeps it root-only; Helena's database never holds it.",
      },
    },
  )
  .delete(
    '/god/server/backup/targets/:id',
    async ({ user, request, params }) => {
      const current = await owner(user, request);
      if (!remoteTargetsEnabled()) throw new HttpError(404, 'Offsite targets are not enabled');
      const result = await call(() =>
        hostd('RemoveBackupTarget', { id: params.id, actor: actorOf(current) }),
      );
      invalidate('backup');
      return result;
    },
    {
      params: targetParams,
      response: { 200: HostReading, ...WRITE_ERRORS },
      detail: { summary: 'Remove an offsite target (the data there stays)' },
    },
  );
