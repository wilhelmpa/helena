#!/usr/bin/env node
// Docker package G only; backup markers and container volumes belong to the legacy stack.
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

export const RESET_VERSION = 1;
export const RESET_CONTRACT_VERSION = 'fresh-2026-09-22-v1';
export const SCRIPT_VERSION = 'plan-fresh-reset-2026-09-22.2';
export const OWNER_EMAIL = 'patrick.wilhelm@volition.one';
export const HOME_PROJECT_KEY = 'HOME';
export const MASTER_AGENT_USERNAME = 'master';
export const DEFAULT_BACKUP_MARKER = '/home/pw/services/volition-backups/last-success';
export const DEFAULT_CREDENTIAL_FILE =
  '/home/pw/services/volition-stack/.secrets/itsaplan_home_master_agent_api_key';
export const DEFAULT_COMPLETION_MARKER =
  '/home/pw/services/volition-stack/reset-state/plan-reset.complete.json';
export const GARAGE_BUCKET = 'planner-attachments';

const PLAN_ROOT = '/home/pw/services/itsaplan';
const LIVE_ROOT = '/home/pw/services/volition-stack';
const GARAGE_ROOT = `${LIVE_ROOT}/garage`;
const GARAGE_ENV_FILE = `${PLAN_ROOT}/.env`;
const GARAGE_CONFIG_FILE = `${GARAGE_ROOT}/garage.toml`;
const GARAGE_MANIFEST_FILE = `${LIVE_ROOT}/backup/tests/garage-manifest.mjs`;
const EMPTY_MANIFEST_SHA256 = createHash('sha256').digest('hex');
const RESTIC_REPOSITORY = '/home/pw/services/volition-backups/restic';
const RESTIC_PASSWORD_FILE = `${LIVE_ROOT}/.secrets/backup_restic_password`;
const RESTIC_CACHE_DIR = '/home/pw/services/volition-backups/cache';
const PLAINTEXT_BACKUP_STAGE = '/home/pw/services/volition-backups/current';
const RESTORE_PROBE_PATH =
  '/home/pw/services/volition-backups/current/database-counts.json';
const RESIDUAL_BACKUP_PATH =
  '/home/pw/services/volition-backups/current/plan-residual-volumes.tar';
const DB_BACKUP_VOLUME = 'itsaplan_db-backups';
const LEGACY_MINIO_VOLUME = 'itsaplan_minio-data';

const PRESERVED_TABLES = new Set([
  'account',
  'app_setting',
  'passkey',
  'session',
  'user',
]);
const TARGET_ROWS = new Map([
  ['ai_agent', 1],
  ['apikey', 1],
  ['project', 1],
  ['project_member', 2],
  ['team', 1],
  ['team_member', 2],
  ['team_role', 1],
]);
const REQUIRED_TABLES = [...TARGET_ROWS.keys(), 'issue', 'vault_entry', 'cycle'];
const REATTEST_OPERATIONAL_TABLES = new Set([
  'hub_inbox_event',
  'hub_inbox_source',
  'hub_inbox_thread',
  'revision',
  'user_preference',
  'vault_entry',
  'vault_link',
  'vault_move',
]);
const PERMISSION_RESOURCES = [
  'work_items',
  'initiatives',
  'cycles',
  'dashboards',
  'documents',
  'views',
  'members_invite',
  'members_manage',
  'states',
  'issue_types',
  'labels',
  'ai_agents',
  'integrations',
  'agent_skills',
  'agent_tools',
  'custom_fields',
  'issue_templates',
  'workflow_config',
  'actions',
  'webhooks',
  'note_boards',
  'danger_zone',
];

function fullPermissions() {
  const limited = {
    danger_zone: new Set(['read', 'delete']),
    workflow_config: new Set(['read', 'edit']),
    members_invite: new Set(['read', 'create', 'delete']),
  };
  return Object.fromEntries(
    PERMISSION_RESOURCES.map((resource) => [
      resource,
      Object.fromEntries(
        ['create', 'edit', 'read', 'delete'].map((action) => [
          action,
          limited[resource] ? limited[resource].has(action) : true,
        ]),
      ),
    ]),
  );
}

export function parseArgs(argv) {
  const options = {
    apply: false,
    json: false,
    reattest: false,
    confirm: '',
    backupMarker: '',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--reattest') options.reattest = true;
    else if (arg === '--confirm') options.confirm = argv[++index] ?? '';
    else if (arg === '--backup-marker') options.backupMarker = argv[++index] ?? '';
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.apply && (options.confirm || options.backupMarker || options.reattest)) {
    throw new Error('--confirm, --backup-marker and --reattest are valid only with --apply');
  }
  if (options.apply) {
    if (options.confirm !== 'RESET_PLAN_TO_HOME') {
      throw new Error('--apply requires --confirm RESET_PLAN_TO_HOME');
    }
    if (resolve(options.backupMarker) !== DEFAULT_BACKUP_MARKER) {
      throw new Error(`--apply requires --backup-marker ${DEFAULT_BACKUP_MARKER}`);
    }
  }
  return options;
}

export async function validateBackupMarker(
  markerPath,
  { now = new Date(), maxAgeMs = 24 * 60 * 60 * 1000, expectedUid = process.getuid?.() } = {},
) {
  const stat = await lstat(markerPath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Backup marker must be a regular file');
  if ((stat.mode & 0o022) !== 0) throw new Error('Backup marker must not be group/world writable');
  if (expectedUid !== undefined && stat.uid !== expectedUid) {
    throw new Error('Backup marker has an unexpected owner');
  }
  let marker;
  try {
    marker = JSON.parse(await readFile(markerPath, 'utf8'));
  } catch {
    throw new Error('Encrypted backup marker is not valid JSON');
  }
  if (
    marker?.schemaVersion !== 1 ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(marker.completedAt ?? '') ||
    !/^[a-f0-9]{64}$/.test(marker.snapshotId ?? '') ||
    marker.restoreProbeVerified !== true ||
    marker.plaintextStagingEmpty !== true
  ) {
    throw new Error('Encrypted backup marker has an invalid schema');
  }
  const completedAt = new Date(marker.completedAt);
  const age = now.getTime() - completedAt.getTime();
  if (!Number.isFinite(completedAt.getTime()) || age < -5 * 60 * 1000 || age > maxAgeMs) {
    throw new Error('Encrypted backup marker is stale or invalid');
  }
  return {
    completedAt: marker.completedAt,
    snapshotId: marker.snapshotId,
    restoreProbeVerified: true,
    plaintextStagingEmpty: true,
    maxAgeHours: Math.floor(maxAgeMs / 3_600_000),
  };
}

export function generateMasterKey() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let random = '';
  for (let index = 0; index < 64; index += 1) random += alphabet[randomInt(alphabet.length)];
  return `itp_${random}`;
}

export function hashMasterKey(value) {
  return createHash('sha256').update(value).digest('base64url');
}

export async function writeCredentialOnce(filePath, value) {
  let handle;
  let created = false;
  try {
    handle = await open(filePath, 'wx', 0o600);
    created = true;
    await handle.writeFile(value, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    const stat = await lstat(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
      throw new Error('Credential file permissions are unsafe');
    }
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if (created) await rm(filePath, { force: true });
    throw error;
  }
}

async function atomicWritePrivate(filePath, value) {
  const temporary = `${filePath}.new-${randomUUID()}`;
  let handle;
  try {
    await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(value, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, filePath);
    await chmod(filePath, 0o600);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true });
    throw error;
  }
}

export function replaceEnvironmentValues(source, replacements) {
  const remaining = new Set(Object.keys(replacements));
  const seen = new Set();
  const lines = source.split('\n').map((line) => {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=/);
    if (!match || !remaining.has(match[1])) return line;
    if (seen.has(match[1])) throw new Error(`Duplicate environment key: ${match[1]}`);
    seen.add(match[1]);
    return `${match[1]}=${replacements[match[1]]}`;
  });
  const missing = [...remaining].filter((key) => !seen.has(key));
  if (missing.length > 0) throw new Error(`Missing environment key: ${missing.join(', ')}`);
  return lines.join('\n');
}

function generateGarageCredentials() {
  return {
    accessKeyId: `GK${randomBytes(16).toString('hex')}`,
    secretAccessKey: randomBytes(32).toString('hex'),
    rpcSecret: randomBytes(32).toString('hex'),
    adminToken: randomBytes(32).toString('hex'),
    metricsToken: randomBytes(32).toString('hex'),
  };
}

function garageConfig(credentials) {
  return `metadata_dir="/meta"
data_dir="/data"
db_engine="sqlite"
replication_factor=1
rpc_bind_addr="0.0.0.0:3901"
rpc_public_addr="127.0.0.1:3901"
rpc_secret="${credentials.rpcSecret}"
[s3_api]
s3_region="garage"
api_bind_addr="0.0.0.0:3900"
root_domain=".s3.garage.localhost"
[admin]
api_bind_addr="0.0.0.0:3903"
admin_token="${credentials.adminToken}"
metrics_token="${credentials.metricsToken}"
`;
}

async function run(command, args, { input = '', accepted = [0], env = process.env } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], env });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      const result = {
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      };
      if (accepted.includes(result.code)) resolvePromise(result);
      else reject(new Error(`${command} failed with exit code ${result.code}`));
    });
    child.stdin.end(input);
  });
}

function composeArgs(...args) {
  return [
    'compose',
    '--project-directory',
    PLAN_ROOT,
    '--env-file',
    GARAGE_ENV_FILE,
    '-f',
    `${PLAN_ROOT}/docker-compose.yml`,
    '-f',
    `${LIVE_ROOT}/compose.hub.yml`,
    ...args,
  ];
}

function parseGarageBucketInfo(output) {
  const match = output.match(/^Objects:\s+(\d+)\s*$/m);
  if (!match) throw new Error('Garage bucket inventory did not contain an object count');
  return Number(match[1]);
}

async function assertPrivateRegularFile(filePath) {
  const stat = await lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error(`Unsafe private file: ${filePath}`);
  }
}

async function assertPrivateDirectory(filePath) {
  const stat = await lstat(filePath);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error(`Unsafe private directory: ${filePath}`);
  }
}

async function inspectPrivateDirectory(filePath) {
  await assertPrivateDirectory(filePath);
  return { path: filePath, entryCount: (await readdir(filePath)).length };
}

export function createGarageObjectStore(command = run) {
  const bucketInfo = async () => {
    const result = await command('docker', [
      'exec',
      'itsaplan-garage-1',
      '/garage',
      'bucket',
      'info',
      GARAGE_BUCKET,
    ]);
    return parseGarageBucketInfo(result.stdout);
  };
  const start = (...services) =>
    command('docker', composeArgs('up', '-d', '--wait', '--wait-timeout', '60', ...services));
  const stopWriters = () => command('docker', composeArgs('stop', 'api', 'worker', 'bot'));

  return {
    async inventory() {
      const manifestSource = await readFile(GARAGE_MANIFEST_FILE, 'utf8');
      const result = await command(
        'docker',
        ['exec', '-i', '-w', '/app/apps/api', 'itsaplan-api-1', 'bun', '-'],
        { input: manifestSource },
      );
      let manifest;
      try {
        manifest = JSON.parse(result.stdout);
      } catch {
        throw new Error('Garage manifest returned invalid JSON');
      }
      if (
        !Number.isSafeInteger(manifest.count) ||
        manifest.count < 0 ||
        !Number.isSafeInteger(manifest.totalBytes) ||
        manifest.totalBytes < 0 ||
        !/^[a-f0-9]{64}$/.test(manifest.sha256 ?? '')
      ) {
        throw new Error('Garage manifest returned invalid fields');
      }
      return { bucket: GARAGE_BUCKET, ...manifest };
    },

    async beginReset() {
      await Promise.all([
        assertPrivateRegularFile(GARAGE_ENV_FILE),
        assertPrivateRegularFile(GARAGE_CONFIG_FILE),
        assertPrivateDirectory(GARAGE_ROOT),
        assertPrivateDirectory(join(GARAGE_ROOT, 'meta')),
        assertPrivateDirectory(join(GARAGE_ROOT, 'data')),
      ]);
      const credentials = generateGarageCredentials();
      const sourceEnvironment = await readFile(GARAGE_ENV_FILE, 'utf8');
      const nextEnvironment = replaceEnvironmentValues(sourceEnvironment, {
        GARAGE_ACCESS_KEY_ID: credentials.accessKeyId,
        GARAGE_SECRET_ACCESS_KEY: credentials.secretAccessKey,
      });
      const stage = join(GARAGE_ROOT, `.fresh-reset-${randomUUID()}`);
      await mkdir(stage, { mode: 0o700 });
      await copyFile(GARAGE_ENV_FILE, join(stage, 'environment.previous'));
      await copyFile(GARAGE_CONFIG_FILE, join(stage, 'garage.toml.previous'));
      await Promise.all([
        chmod(join(stage, 'environment.previous'), 0o600),
        chmod(join(stage, 'garage.toml.previous'), 0o600),
      ]);
      const session = { stage, movedMeta: false, movedData: false, configurationChanged: false };
      try {
        await stopWriters();
        await command('docker', composeArgs('stop', 'garage'));
        await rename(join(GARAGE_ROOT, 'meta'), join(stage, 'meta.previous'));
        session.movedMeta = true;
        await rename(join(GARAGE_ROOT, 'data'), join(stage, 'data.previous'));
        session.movedData = true;
        await Promise.all([
          mkdir(join(GARAGE_ROOT, 'meta'), { mode: 0o700 }),
          mkdir(join(GARAGE_ROOT, 'data'), { mode: 0o700 }),
        ]);
        session.configurationChanged = true;
        await atomicWritePrivate(GARAGE_CONFIG_FILE, garageConfig(credentials));
        await atomicWritePrivate(GARAGE_ENV_FILE, nextEnvironment);
        await start('garage');
        if ((await bucketInfo()) !== 0) throw new Error('Fresh Garage bucket is not empty');
        return session;
      } catch (error) {
        try {
          await this.rollback(session);
        } catch (rollbackError) {
          throw new AggregateError([error, rollbackError], 'Garage reset and rollback both failed');
        }
        throw error;
      }
    },

    async rollback(session) {
      await command('docker', composeArgs('stop', 'garage'), { accepted: [0] });
      if (session.configurationChanged) {
        await atomicWritePrivate(
          GARAGE_ENV_FILE,
          await readFile(join(session.stage, 'environment.previous'), 'utf8'),
        );
        await atomicWritePrivate(
          GARAGE_CONFIG_FILE,
          await readFile(join(session.stage, 'garage.toml.previous'), 'utf8'),
        );
      }
      if (session.movedMeta) {
        await rm(join(GARAGE_ROOT, 'meta'), { recursive: true, force: true });
        await rename(join(session.stage, 'meta.previous'), join(GARAGE_ROOT, 'meta'));
      }
      if (session.movedData) {
        await rm(join(GARAGE_ROOT, 'data'), { recursive: true, force: true });
        await rename(join(session.stage, 'data.previous'), join(GARAGE_ROOT, 'data'));
      }
      await rm(session.stage, { recursive: true, force: true });
      await start('garage', 'api', 'worker');
    },

    async verifyFresh() {
      await start('api');
      const inventory = await this.inventory();
      if (
        inventory.bucket !== GARAGE_BUCKET ||
        inventory.count !== 0 ||
        inventory.totalBytes !== 0 ||
        inventory.sha256 !== EMPTY_MANIFEST_SHA256
      ) {
        throw new Error('Post-reset Garage manifest is not empty');
      }
      await start('worker');
      return inventory;
    },

    async complete(session) {
      await rm(session.stage, { recursive: true, force: true });
    },

    async failClosed() {
      await stopWriters();
    },
  };
}

function resticEnvironment({ repository, passwordFile, cacheDir }) {
  return {
    ...process.env,
    RESTIC_REPOSITORY: repository,
    RESTIC_PASSWORD_FILE: passwordFile,
    RESTIC_CACHE_DIR: cacheDir,
    GOMEMLIMIT: '512MiB',
    GOMAXPROCS: '2',
  };
}

export function createEncryptedBackupGate(
  command = run,
  {
    repository = RESTIC_REPOSITORY,
    passwordFile = RESTIC_PASSWORD_FILE,
    cacheDir = RESTIC_CACHE_DIR,
    restoreProbePath = RESTORE_PROBE_PATH,
    residualBackupPath = RESIDUAL_BACKUP_PATH,
    restoreParent = '/home/pw/services/volition-backups/',
    plaintextStage = PLAINTEXT_BACKUP_STAGE,
  } = {},
) {
  const environment = resticEnvironment({ repository, passwordFile, cacheDir });
  return {
    async inventory() {
      const inventory = await inspectPrivateDirectory(plaintextStage);
      return { entryCount: inventory.entryCount, empty: inventory.entryCount === 0 };
    },
    async verify(snapshotId) {
      if (!/^[a-f0-9]{64}$/.test(snapshotId ?? '')) {
        throw new Error('Backup restore gate requires a full snapshot id');
      }
      const snapshots = await command('restic', ['snapshots', '--json', snapshotId], {
        env: environment,
      });
      let rows;
      try {
        rows = JSON.parse(snapshots.stdout);
      } catch {
        throw new Error('Restic snapshot lookup returned invalid JSON');
      }
      if (!Array.isArray(rows) || rows.length !== 1 || rows[0]?.id !== snapshotId) {
        throw new Error('Encrypted backup snapshot does not exist exactly as marked');
      }

      const restoreRoot = await mkdtemp(`${restoreParent}restore-gate-`);
      try {
        await chmod(restoreRoot, 0o700);
        await command(
          'restic',
          [
            'restore',
            snapshotId,
            '--target',
            restoreRoot,
            '--include',
            restoreProbePath,
            '--include',
            residualBackupPath,
          ],
          { env: environment },
        );
        const restored = `${restoreRoot}${restoreProbePath}`;
        await assertPrivateRegularFile(restored);
        let manifest;
        try {
          manifest = JSON.parse(await readFile(restored, 'utf8'));
        } catch {
          throw new Error('Restored database-count manifest is invalid JSON');
        }
        if (
          !/^\d+(?:,\d+){4}$/.test(manifest?.plan ?? '') ||
          !/^\d+(?:,\d+){2}$/.test(manifest?.nextcloud ?? '')
        ) {
          throw new Error('Restored database-count manifest has invalid fields');
        }
        const residualArchive = `${restoreRoot}${residualBackupPath}`;
        await assertPrivateRegularFile(residualArchive);
        const archive = await command('tar', ['-tf', residualArchive]);
        const names = archive.stdout.split('\n').filter(Boolean);
        if (
          !names.some((name) => /^\.\/itsaplan-db-backups(?:\/|$)/.test(name)) ||
          !names.some((name) => /^\.\/itsaplan-minio-data(?:\/|$)/.test(name))
        ) {
          throw new Error('Restored Plan residual-volume archive is incomplete');
        }
        const staging = await this.inventory();
        if (!staging.empty) throw new Error('Plaintext backup staging is not empty');
        return {
          snapshotId,
          restoreVerified: true,
          plaintextStagingEmpty: true,
        };
      } finally {
        await rm(restoreRoot, { recursive: true, force: true });
      }
    },
  };
}

function volumeContainerArgs({
  readOnlyVolumes,
  stage,
  script,
  dbBackupVolume,
  legacyMinioVolume,
}) {
  const args = [
    'run',
    '--rm',
    '--network',
    'none',
    '--read-only',
    '--security-opt',
    'no-new-privileges:true',
    '--cap-drop',
    'ALL',
    '-v',
    `${dbBackupVolume}:/vol/db${readOnlyVolumes ? ':ro' : ''}`,
    '-v',
    `${legacyMinioVolume}:/vol/minio${readOnlyVolumes ? ':ro' : ''}`,
  ];
  // The PostgreSQL backup volume is owned by the unprivileged application UID.
  // Without DAC_OVERRIDE, BusyBox find reports EACCES but still exits zero, which
  // can leave old dumps behind. Restore also needs to reinstate archived owners.
  if (stage || !readOnlyVolumes) args.push('--cap-add', 'DAC_OVERRIDE');
  if (stage && !readOnlyVolumes) args.push('--cap-add', 'CHOWN', '--cap-add', 'FOWNER');
  if (stage) args.push('-v', `${stage}:/rollback`);
  args.push('alpine:3.22', 'sh', '-ceu', script);
  return args;
}

function parseVolumeInventory(output) {
  const values = new Map();
  for (const line of output.trim().split('\n')) {
    const match = line.match(/^(dbBackups|legacyMinio)=(\d+)$/);
    if (!match || values.has(match[1])) throw new Error('Plan volume inventory is invalid');
    values.set(match[1], Number(match[2]));
  }
  if (values.size !== 2) throw new Error('Plan volume inventory is incomplete');
  return {
    dbBackupEntries: values.get('dbBackups'),
    legacyMinioEntries: values.get('legacyMinio'),
  };
}

export function createPlanVolumeStore(
  command = run,
  {
    dbBackupVolume = DB_BACKUP_VOLUME,
    legacyMinioVolume = LEGACY_MINIO_VOLUME,
  } = {},
) {
  const containerArgs = (options) =>
    volumeContainerArgs({ ...options, dbBackupVolume, legacyMinioVolume });
  const inventory = async () => {
    const result = await command(
      'docker',
      containerArgs({
        readOnlyVolumes: true,
        script:
          "printf 'dbBackups='; find /vol/db -mindepth 1 | wc -l; " +
          "printf 'legacyMinio='; find /vol/minio -mindepth 1 | wc -l",
      }),
    );
    return parseVolumeInventory(result.stdout);
  };
  const clear = () =>
    command(
      'docker',
      containerArgs({
        readOnlyVolumes: false,
        script: 'find /vol/db /vol/minio -mindepth 1 -delete',
      }),
    );

  return {
    inventory,
    async beginReset(stage) {
      await assertPrivateDirectory(stage);
      const session = { stage, archived: false, cleared: false };
      try {
        await command(
          'docker',
          containerArgs({
            readOnlyVolumes: true,
            stage,
            script:
              "umask 077; tar -C /vol -cf /rollback/plan-volumes.previous.tar db minio; " +
              'chmod 600 /rollback/plan-volumes.previous.tar',
          }),
        );
        session.archived = true;
        await clear();
        session.cleared = true;
        const after = await inventory();
        if (after.dbBackupEntries !== 0 || after.legacyMinioEntries !== 0) {
          throw new Error('Plan residual Docker volumes are not empty');
        }
        return session;
      } catch (error) {
        if (session.archived) await this.rollback(session);
        throw error;
      }
    },
    async rollback(session) {
      if (!session.archived) return;
      await clear();
      await command(
        'docker',
        containerArgs({
          readOnlyVolumes: false,
          stage: session.stage,
          script: 'tar -C /vol -xf /rollback/plan-volumes.previous.tar',
        }),
      );
    },
    async verifyFresh() {
      const after = await inventory();
      if (after.dbBackupEntries !== 0 || after.legacyMinioEntries !== 0) {
        throw new Error('Post-reset Plan residual Docker volumes are not empty');
      }
      return after;
    },
  };
}

function psqlArgs() {
  return [
    'exec',
    '-i',
    'itsaplan-postgres-1',
    'psql',
    '-X',
    '-v',
    'ON_ERROR_STOP=1',
    '-U',
    'itsaplan',
    '-d',
    'itsaplan',
    '-At',
  ];
}

function literal(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

const tableCountSql = String.raw`SELECT format(
  'SELECT %L || ''|'' || count(*)::text FROM %I.%I;',
  tablename,
  schemaname,
  tablename
)
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename
\gexec
`;

const factsSql = String.raw`SELECT json_build_object(
  'ownerId', (SELECT id FROM "user" WHERE lower(email) = lower(${literal(OWNER_EMAIL)}) LIMIT 1),
  'ownerMatches', (SELECT count(*)::int FROM "user" WHERE lower(email) = lower(${literal(OWNER_EMAIL)})),
  'ownerGod', COALESCE((SELECT role = 'god' FROM "user" WHERE lower(email) = lower(${literal(OWNER_EMAIL)}) LIMIT 1), false),
  'authSettings', (SELECT count(*)::int FROM app_setting WHERE key = 'auth'),
  'otherAppSettings', (SELECT count(*)::int FROM app_setting WHERE key <> 'auth'),
  'totalUsers', (SELECT count(*)::int FROM "user"),
  'agentUsers', (SELECT count(*)::int FROM "user" u JOIN ai_agent a ON a.user_id = u.id),
  'homeProjects', (SELECT count(*)::int FROM project WHERE key = ${literal(HOME_PROJECT_KEY)} AND name = 'Home' AND mcp_enabled),
  'masterAgents', (SELECT count(*)::int FROM ai_agent WHERE username = ${literal(MASTER_AGENT_USERNAME)} AND kind = 'external'),
  'masterMemberships', (
    SELECT count(*)::int
    FROM ai_agent a
    JOIN project_member pm ON pm.user_id = a.user_id
    JOIN project p ON p.id = pm.project_id
    WHERE a.username = ${literal(MASTER_AGENT_USERNAME)} AND p.key = ${literal(HOME_PROJECT_KEY)}
  )
);
`;

function parseTableCounts(output) {
  const counts = new Map();
  for (const line of output.trim().split('\n').filter(Boolean)) {
    const match = line.match(/^([a-z][a-z0-9_]*)\|(\d+)$/);
    if (!match) throw new Error('Database inventory returned an invalid table count');
    counts.set(match[1], Number(match[2]));
  }
  return counts;
}

export function isTargetState(inventory) {
  if (
    inventory.facts.ownerMatches !== 1 ||
    inventory.facts.ownerGod !== true ||
    inventory.facts.totalUsers !== 2 ||
    inventory.facts.authSettings > 1 ||
    inventory.facts.otherAppSettings !== 0 ||
    inventory.facts.agentUsers !== 1 ||
    inventory.facts.homeProjects !== 1 ||
    inventory.facts.masterAgents !== 1 ||
    inventory.facts.masterMemberships !== 1
  ) {
    return false;
  }
  for (const table of REQUIRED_TABLES) if (!inventory.counts.has(table)) return false;
  for (const [table, count] of inventory.counts) {
    if (PRESERVED_TABLES.has(table)) continue;
    if (count !== (TARGET_ROWS.get(table) ?? 0)) return false;
  }
  return true;
}

export function isReattestableTargetState(inventory) {
  if (
    inventory.facts.ownerMatches !== 1 ||
    inventory.facts.ownerGod !== true ||
    inventory.facts.totalUsers !== 2 ||
    inventory.facts.authSettings > 1 ||
    inventory.facts.otherAppSettings !== 0 ||
    inventory.facts.agentUsers !== 1 ||
    inventory.facts.homeProjects !== 1 ||
    inventory.facts.masterAgents !== 1 ||
    inventory.facts.masterMemberships !== 1
  ) {
    return false;
  }
  for (const table of REQUIRED_TABLES) if (!inventory.counts.has(table)) return false;
  for (const [table, count] of inventory.counts) {
    if (PRESERVED_TABLES.has(table) || REATTEST_OPERATIONAL_TABLES.has(table)) continue;
    if (count !== (TARGET_ROWS.get(table) ?? 0)) return false;
  }
  return true;
}

function hasOperationalRows(inventory) {
  return [...REATTEST_OPERATIONAL_TABLES].some((table) => (inventory.counts.get(table) ?? 0) > 0);
}

export function summarizeInventory(inventory) {
  const count = (name) => inventory.counts.get(name) ?? 0;
  return {
    resetVersion: RESET_VERSION,
    target: isTargetState(inventory),
    counts: {
      users: inventory.facts.totalUsers,
      teams: count('team'),
      projects: count('project'),
      tasks: count('issue'),
      documents: count('vault_entry'),
      files: count('issue_attachment') + count('initiative_attachment') + count('chat_attachment'),
      workflows: count('project_workflow_assignment') + count('project_action'),
      cycles: count('cycle'),
      schedules: count('helena_schedule'),
      runs: count('agent_run') + count('project_action_run') + count('pipeline_run'),
      agents: count('ai_agent'),
      skills: count('agent_skill'),
      connections: count('integration_credential') + count('git_provider_connection'),
      appSecrets: count('app_secret'),
      authSettings: inventory.facts.authSettings,
      otherAppSettings: inventory.facts.otherAppSettings,
    },
  };
}

export function resetSql({ ownerId, agentUserId, agentEmail, apiKeyId, apiKeyHash }) {
  for (const value of [ownerId, agentUserId, agentEmail, apiKeyId, apiKeyHash]) {
    if (typeof value !== 'string' || value.length < 3 || value.length > 256) {
      throw new Error('Invalid bootstrap identifier');
    }
  }
  const permissions = JSON.stringify(fullPermissions());
  return String.raw`BEGIN;
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '120s';
SELECT pg_advisory_xact_lock(8242, ${RESET_VERSION});
DO $lock$
DECLARE names text;
BEGIN
  SELECT string_agg(format('%I.%I', schemaname, tablename), ', ' ORDER BY tablename)
  INTO names FROM pg_tables WHERE schemaname = 'public';
  EXECUTE 'LOCK TABLE ' || names || ' IN ACCESS EXCLUSIVE MODE';
END
$lock$;
DO $owner$
BEGIN
  IF (SELECT count(*) FROM "user" WHERE lower(email) = lower(${literal(OWNER_EMAIL)})) <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one reset owner';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "user"
    WHERE id = ${literal(ownerId)} AND lower(email) = lower(${literal(OWNER_EMAIL)})
      AND role = 'god' AND active
  ) THEN
    RAISE EXCEPTION 'Reset owner is not the active instance owner';
  END IF;
END
$owner$;
DO $truncate$
DECLARE names text;
BEGIN
  SELECT string_agg(format('%I.%I', schemaname, tablename), ', ' ORDER BY tablename)
  INTO names
  FROM pg_tables
  WHERE schemaname = 'public'
    AND tablename NOT IN ('account', 'app_setting', 'passkey', 'session', 'user');
  EXECUTE 'TRUNCATE TABLE ' || names || ' RESTART IDENTITY CASCADE';
END
$truncate$;
-- The workflow engine's execution state belongs to the runs just removed. The API creates
-- the schema again when it starts.
DROP SCHEMA IF EXISTS helena_engine CASCADE;
DELETE FROM app_setting WHERE key <> 'auth';
DELETE FROM "user" WHERE id <> ${literal(ownerId)};
INSERT INTO team (name, mcp_enabled) VALUES ('Home', true);
INSERT INTO team_member (team_id, user_id, role)
SELECT id, ${literal(ownerId)}, 'owner' FROM team;
INSERT INTO team_role (team_id, name, is_default, permissions)
SELECT id, 'Master', true, ${literal(permissions)}::jsonb FROM team;
INSERT INTO project (
  team_id, key, name, description, mcp_enabled,
  initiatives_enabled, dashboards_enabled, documents_enabled, notes_enabled,
  cycles_enabled, subtasks_enabled, checklists_enabled, issue_stats_enabled
)
SELECT id, ${literal(HOME_PROJECT_KEY)}, 'Home',
  'Private technical anchor for the Home chat.', true,
  false, false, false, false, false, false, false, false
FROM team;
INSERT INTO project_member (project_id, user_id, role)
SELECT id, ${literal(ownerId)}, 'owner' FROM project WHERE key = ${literal(HOME_PROJECT_KEY)};
INSERT INTO "user" (id, name, email, email_verified, role, active)
VALUES (${literal(agentUserId)}, 'Home Master', ${literal(agentEmail)}, false, 'user', true);
INSERT INTO ai_agent (
  team_id, user_id, username, kind, trigger_on_mention, trigger_on_assign,
  delegation_delay_sec, runtime_policy, runtime_state, owner_user_id, runner_scope
)
SELECT id, ${literal(agentUserId)}, ${literal(MASTER_AGENT_USERNAME)}, 'external',
  false, false, 0,
  '{"reasoningEffort":"medium","toolAllow":[],"toolDeny":[],"mcpGrants":[],"files":[]}'::jsonb,
  '{}'::jsonb, ${literal(ownerId)}, 'owner'
FROM team;
INSERT INTO team_member (team_id, user_id, role)
SELECT id, ${literal(agentUserId)}, 'agent' FROM team;
INSERT INTO project_member (project_id, user_id, role, role_id)
SELECT p.id, ${literal(agentUserId)}, 'member', r.id
FROM project p JOIN team_role r ON r.team_id = p.team_id AND r.is_default
WHERE p.key = ${literal(HOME_PROJECT_KEY)};
INSERT INTO apikey (
  id, config_id, name, start, reference_id, prefix, key, enabled,
  rate_limit_enabled, rate_limit_time_window, rate_limit_max, request_count,
  expires_at, created_at, updated_at
)
VALUES (
  ${literal(apiKeyId)}, 'default', 'agent:Home Master', 'itp_', ${literal(agentUserId)},
  'itp_', ${literal(apiKeyHash)}, true, true, 1000, 100, 0, null, now(), now()
);
DO $verify$
DECLARE row record; actual bigint; expected bigint;
BEGIN
  IF (SELECT count(*) FROM "user") <> 2 THEN RAISE EXCEPTION 'Target user count failed'; END IF;
  IF (SELECT count(*) FROM app_secret) <> 0 THEN RAISE EXCEPTION 'Target app secret count failed'; END IF;
  IF (SELECT count(*) FROM app_setting WHERE key <> 'auth') <> 0 OR (SELECT count(*) FROM app_setting) > 1 THEN RAISE EXCEPTION 'Target app setting count failed'; END IF;
  IF (SELECT count(*) FROM team) <> 1 THEN RAISE EXCEPTION 'Target team count failed'; END IF;
  IF (SELECT count(*) FROM project WHERE key = 'HOME' AND mcp_enabled) <> 1 THEN RAISE EXCEPTION 'Target project count failed'; END IF;
  IF (SELECT count(*) FROM ai_agent WHERE username = 'master' AND kind = 'external') <> 1 THEN RAISE EXCEPTION 'Target agent count failed'; END IF;
  IF (SELECT count(*) FROM apikey WHERE reference_id = ${literal(agentUserId)} AND key = ${literal(apiKeyHash)}) <> 1 THEN RAISE EXCEPTION 'Target key count failed'; END IF;
  FOR row IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT IN (
        'account', 'app_setting', 'passkey', 'session', 'user',
        'ai_agent', 'apikey', 'project', 'project_member', 'team', 'team_member', 'team_role'
      )
  LOOP
    EXECUTE format('SELECT count(*) FROM %I', row.tablename) INTO actual;
    IF actual <> 0 THEN RAISE EXCEPTION 'Residual rows in %', row.tablename; END IF;
  END LOOP;
  FOR row IN SELECT * FROM (VALUES
    ('ai_agent', 1), ('apikey', 1), ('project', 1), ('project_member', 2),
    ('team', 1), ('team_member', 2), ('team_role', 1)
  ) AS expected_rows(tablename, expected_count)
  LOOP
    EXECUTE format('SELECT count(*) FROM %I', row.tablename) INTO actual;
    expected := row.expected_count;
    IF actual <> expected THEN RAISE EXCEPTION 'Unexpected row count in %', row.tablename; END IF;
  END LOOP;
END
$verify$;
COMMIT;
`;
}

export function createDockerDatabase(command = run) {
  const execute = async (sql) => (await command('docker', psqlArgs(), { input: sql })).stdout.trim();
  return {
    async inventory() {
      const [countsRaw, factsRaw] = await Promise.all([execute(tableCountSql), execute(factsSql)]);
      let facts;
      try {
        facts = JSON.parse(factsRaw);
      } catch {
        throw new Error('Database inventory returned invalid facts');
      }
      return { counts: parseTableCounts(countsRaw), facts };
    },
    async reset(input) {
      await execute(resetSql(input));
    },
    async keyMatches(hash) {
      const sql = `SELECT count(*)::int FROM apikey k JOIN ai_agent a ON a.user_id = k.reference_id WHERE a.username = ${literal(MASTER_AGENT_USERNAME)} AND k.key = ${literal(hash)};\n`;
      return (await execute(sql)) === '1';
    },
    async validateReattestation(completedAt) {
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(completedAt ?? '')) {
        throw new Error('Existing completion marker has an invalid completion time');
      }
      const cutoff = literal(completedAt);
      const sql = String.raw`WITH home AS (
  SELECT id, team_id FROM project WHERE key = ${literal(HOME_PROJECT_KEY)}
), target_users AS (
  SELECT id FROM "user"
), recent_hub_xids AS (
  SELECT xmin::text AS xid FROM hub_inbox_source WHERE created_at >= ${cutoff}::timestamptz
  UNION
  SELECT xmin::text AS xid FROM hub_inbox_thread WHERE created_at >= ${cutoff}::timestamptz
  UNION
  SELECT xmin::text AS xid FROM hub_inbox_event WHERE created_at >= ${cutoff}::timestamptz
), invalid AS (
  SELECT 1 FROM hub_inbox_source s, home h
  WHERE s.created_at IS NULL OR s.created_at < ${cutoff}::timestamptz
    OR s.team_id IS DISTINCT FROM h.team_id
    OR (s.auto_task_project_id IS NOT NULL AND s.auto_task_project_id IS DISTINCT FROM h.id)
    OR (s.automation_actor_user_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM target_users u WHERE u.id = s.automation_actor_user_id
    ))
  UNION ALL
  SELECT 1 FROM hub_inbox_thread t, home h
  WHERE t.created_at IS NULL OR t.created_at < ${cutoff}::timestamptz
    OR t.team_id IS DISTINCT FROM h.team_id
    OR NOT EXISTS (
      SELECT 1 FROM hub_inbox_source s
      WHERE s.id = t.source_id AND s.team_id = h.team_id
    )
    OR (t.project_id IS NOT NULL AND t.project_id IS DISTINCT FROM h.id)
    OR t.issue_id IS NOT NULL
    OR t.triage_run_id IS NOT NULL
  UNION ALL
  SELECT 1 FROM hub_inbox_event e, home h
  WHERE e.created_at IS NULL OR e.created_at < ${cutoff}::timestamptz
    OR e.team_id IS DISTINCT FROM h.team_id
    OR NOT EXISTS (
      SELECT 1 FROM hub_inbox_source s
      WHERE s.id = e.source_id AND s.team_id = h.team_id
    )
    OR e.issue_activity_id IS NOT NULL
  UNION ALL
  SELECT 1 FROM revision r, home h
  WHERE r.scope IS DISTINCT FROM ('hub-inbox:' || h.team_id::text)
    OR r.project_id IS DISTINCT FROM h.id
    OR NOT EXISTS (SELECT 1 FROM recent_hub_xids x WHERE x.xid = r.xmin::text)
  UNION ALL
  SELECT 1 FROM user_preference p, home h
  WHERE p.created_at IS NULL OR p.created_at < ${cutoff}::timestamptz
    OR NOT EXISTS (SELECT 1 FROM target_users u WHERE u.id = p.user_id)
    OR (p.last_project_id IS NOT NULL AND p.last_project_id IS DISTINCT FROM h.id)
)
SELECT json_build_object('valid', NOT EXISTS (SELECT 1 FROM invalid));
`;
      let result;
      try {
        result = JSON.parse(await execute(sql));
      } catch {
        throw new Error('Operational-row re-attestation check returned invalid data');
      }
      if (result?.valid !== true) {
        throw new Error('Operational rows are not safe for completion-marker re-attestation');
      }
      return result;
    },
  };
}

async function assertRuntimeReady(command = run) {
  if (process.getuid?.() !== 1000 || process.getgid?.() !== 1000) {
    throw new Error('Fresh reset must run as the pw operator (uid/gid 1000)');
  }
  const runner = await command(
    'systemctl',
    ['--user', 'is-active', 'volition-hermes-runner.service'],
    { accepted: [0, 3, 4] },
  );
  if (runner.code === 0) throw new Error('volition-hermes-runner.service must be stopped');
  const inspected = await command('docker', [
    'inspect',
    '--format',
    '{{json .Config.Env}}',
    'itsaplan-web-1',
  ]);
  let env;
  try {
    env = JSON.parse(inspected.stdout.trim());
  } catch {
    throw new Error('Could not inspect the web runtime configuration');
  }
  const values = new Map(env.map((line) => String(line).split(/=(.*)/s).slice(0, 2)));
  if (values.get('HOME_CHAT_PROJECT_KEY') !== HOME_PROJECT_KEY) {
    throw new Error('The web runtime must set HOME_CHAT_PROJECT_KEY=HOME before reset');
  }
  if (values.has('MASTER_AGENT_USERNAME') && values.get('MASTER_AGENT_USERNAME') !== MASTER_AGENT_USERNAME) {
    throw new Error('The web runtime MASTER_AGENT_USERNAME must be master');
  }
  return { homeSystemScopeReady: true, homeChatProjectKey: HOME_PROJECT_KEY };
}

async function readCredential(filePath) {
  const stat = await lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error('Credential file permissions are unsafe');
  }
  const value = await readFile(filePath, 'utf8');
  if (!/^itp_[A-Za-z]{64}$/.test(value)) throw new Error('Credential file is invalid');
  return value;
}

export async function writeCompletionMarker(
  filePath,
  {
    backup,
    backupVerification,
    database,
    garage,
    volumes,
    runtime,
    completedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  },
) {
  if (!/^[a-f0-9]{64}$/.test(backup?.snapshotId ?? '')) {
    throw new Error('Cannot complete reset without a valid backup snapshot id');
  }
  if (
    backupVerification?.snapshotId !== backup.snapshotId ||
    backupVerification?.restoreVerified !== true ||
    backupVerification?.plaintextStagingEmpty !== true
  ) {
    throw new Error('Cannot complete reset before exact backup restore and staging verification');
  }
  if (!isTargetState(database)) throw new Error('Cannot complete reset before database verification');
  if (
    garage?.bucket !== GARAGE_BUCKET ||
    garage?.count !== 0 ||
    garage?.totalBytes !== 0 ||
    garage?.sha256 !== EMPTY_MANIFEST_SHA256
  ) {
    throw new Error('Cannot complete reset before Garage verification');
  }
  if (volumes?.dbBackupEntries !== 0 || volumes?.legacyMinioEntries !== 0) {
    throw new Error('Cannot complete reset before residual volume verification');
  }
  if (
    runtime?.homeSystemScopeReady !== true ||
    runtime?.homeChatProjectKey !== HOME_PROJECT_KEY
  ) {
    throw new Error('Cannot complete reset before HOME system-scope verification');
  }
  const marker = {
    schemaVersion: 1,
    resetVersion: RESET_CONTRACT_VERSION,
    scriptVersion: SCRIPT_VERSION,
    completedAt,
    backupSnapshotId: backup.snapshotId,
    planDatabaseEmpty: true,
    garageReset: true,
    garageCredentialsRotated: true,
    garageBucket: GARAGE_BUCKET,
    garageObjectCount: 0,
    garageManifestSha256: garage.sha256,
    planDbBackupsRemoved: true,
    legacyMinioVolumeRemoved: true,
    planDbBackupVolumeCount: 0,
    legacyMinioObjectCount: 0,
    backupRestoreVerified: true,
    backupPlaintextStagingEmpty: true,
    homeSystemScopeReady: true,
    homeChatProjectKey: HOME_PROJECT_KEY,
    visibleProjectCount: 0,
    ownerCount: 1,
    userDataEmpty: true,
    databaseCounts: summarizeInventory(database).counts,
  };
  await atomicWritePrivate(filePath, `${JSON.stringify(marker, null, 2)}\n`);
  return marker;
}

const COMPLETION_DATABASE_COUNTS = {
  users: 2,
  teams: 1,
  projects: 1,
  tasks: 0,
  documents: 0,
  files: 0,
  workflows: 0,
  cycles: 0,
  schedules: 0,
  runs: 0,
  agents: 1,
  skills: 0,
  connections: 0,
  appSecrets: 0,
  authSettings: 1,
  otherAppSettings: 0,
};

function hasCompletionDatabaseCounts(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const expected = Object.entries(COMPLETION_DATABASE_COUNTS);
  return (
    Object.keys(value).length === expected.length &&
    expected.every(([name, count]) => value[name] === count)
  );
}

function assertBackupVerification(backup, backupVerification) {
  if (
    backupVerification?.snapshotId !== backup?.snapshotId ||
    backupVerification?.restoreVerified !== true ||
    backupVerification?.plaintextStagingEmpty !== true
  ) {
    throw new Error('Exact backup restore and staging verification did not succeed');
  }
}

export async function writeReattestedCompletionMarker(
  filePath,
  {
    existing,
    backup,
    backupVerification,
    reattestedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  },
) {
  assertBackupVerification(backup, backupVerification);
  if (existing.backupSnapshotId === backup.snapshotId) {
    throw new Error('Re-attestation requires a new backup snapshot');
  }
  const marker = {
    ...existing,
    backupSnapshotId: backup.snapshotId,
    backupRestoreVerified: true,
    backupPlaintextStagingEmpty: true,
    reattested: true,
    reattestedAt,
    previousBackupSnapshotId: existing.backupSnapshotId,
  };
  await atomicWritePrivate(filePath, `${JSON.stringify(marker, null, 2)}\n`);
  return marker;
}

export async function validateCompletionMarker(filePath) {
  await assertPrivateRegularFile(filePath);
  let marker;
  try {
    marker = JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    throw new Error('Plan reset completion marker is not valid JSON');
  }
  if (
    marker?.schemaVersion !== 1 ||
    marker?.resetVersion !== RESET_CONTRACT_VERSION ||
    marker?.scriptVersion !== SCRIPT_VERSION ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(marker.completedAt ?? '') ||
    !/^[a-f0-9]{64}$/.test(marker.backupSnapshotId ?? '') ||
    marker.planDatabaseEmpty !== true ||
    marker.garageReset !== true ||
    marker.garageCredentialsRotated !== true ||
    marker.garageBucket !== GARAGE_BUCKET ||
    marker.garageObjectCount !== 0 ||
    marker.garageManifestSha256 !== EMPTY_MANIFEST_SHA256 ||
    marker.planDbBackupsRemoved !== true ||
    marker.legacyMinioVolumeRemoved !== true ||
    marker.planDbBackupVolumeCount !== 0 ||
    marker.legacyMinioObjectCount !== 0 ||
    marker.backupRestoreVerified !== true ||
    marker.backupPlaintextStagingEmpty !== true ||
    marker.homeSystemScopeReady !== true ||
    marker.homeChatProjectKey !== HOME_PROJECT_KEY ||
    marker.visibleProjectCount !== 0 ||
    marker.ownerCount !== 1 ||
    marker.userDataEmpty !== true ||
    !hasCompletionDatabaseCounts(marker.databaseCounts)
  ) {
    throw new Error('Plan reset completion marker has an invalid schema or state');
  }
  const hasReattestationFields =
    marker.reattested !== undefined ||
    marker.reattestedAt !== undefined ||
    marker.previousBackupSnapshotId !== undefined;
  if (
    hasReattestationFields &&
    (marker.reattested !== true ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(marker.reattestedAt ?? '') ||
      new Date(marker.reattestedAt).getTime() < new Date(marker.completedAt).getTime() ||
      !/^[a-f0-9]{64}$/.test(marker.previousBackupSnapshotId ?? '') ||
      marker.previousBackupSnapshotId === marker.backupSnapshotId)
  ) {
    throw new Error('Plan reset completion marker has invalid re-attestation fields');
  }
  return marker;
}

export async function runFreshReset(
  options,
  {
    database,
    backupMarker = DEFAULT_BACKUP_MARKER,
    credentialFile = DEFAULT_CREDENTIAL_FILE,
    completionMarker = DEFAULT_COMPLETION_MARKER,
    validateMarker = validateBackupMarker,
    validateComplete = validateCompletionMarker,
    runtimeReady = assertRuntimeReady,
    createKey = generateMasterKey,
    writeCredential = writeCredentialOnce,
    removeCredential = (path) => rm(path, { force: true }),
    removeCompletion = (path) => rm(path, { force: true }),
    writeComplete = writeCompletionMarker,
    writeReattested = writeReattestedCompletionMarker,
    objectStore = createGarageObjectStore(),
    volumeStore = createPlanVolumeStore(),
    backupGate = createEncryptedBackupGate(),
  },
) {
  const before = await database.inventory();
  const [garageBefore, volumesBefore, backupStagingBefore] = await Promise.all([
    objectStore.inventory(),
    volumeStore.inventory(),
    backupGate.inventory(),
  ]);
  if (!options.apply) {
    return {
      mode: 'dry-run',
      before: summarizeInventory(before),
      garage: garageBefore,
      residualVolumes: volumesBefore,
      backupPlaintextStaging: backupStagingBefore,
    };
  }

  if (isReattestableTargetState(before)) {
    try {
      const current = await readCredential(credentialFile);
      if (
        (await database.keyMatches(hashMasterKey(current))) &&
        garageBefore.bucket === GARAGE_BUCKET &&
        garageBefore.count === 0 &&
        garageBefore.totalBytes === 0 &&
        garageBefore.sha256 === EMPTY_MANIFEST_SHA256 &&
        volumesBefore.dbBackupEntries === 0 &&
        volumesBefore.legacyMinioEntries === 0 &&
        backupStagingBefore.empty
      ) {
        const marker = await validateComplete(completionMarker);
        if (hasOperationalRows(before)) {
          if (typeof database.validateReattestation !== 'function') {
            throw new Error('Operational rows require explicit re-attestation validation');
          }
          await database.validateReattestation(marker.completedAt);
        }
        if (options.reattest) {
          const backup = await validateMarker(backupMarker);
          if (backup.snapshotId === marker.backupSnapshotId) {
            throw new Error('Re-attestation requires a new backup snapshot');
          }
          const backupVerification = await backupGate.verify(backup.snapshotId);
          assertBackupVerification(backup, backupVerification);
          const completion = await writeReattested(completionMarker, {
            existing: marker,
            backup,
            backupVerification,
          });
          return {
            mode: 'apply',
            changed: false,
            reattested: true,
            after: summarizeInventory(before),
            garage: garageBefore,
            residualVolumes: volumesBefore,
            backupPlaintextStaging: backupStagingBefore,
            backupVerification,
            completion,
          };
        }
        return {
          mode: 'apply',
          changed: false,
          reattested: false,
          after: summarizeInventory(before),
          garage: garageBefore,
          residualVolumes: volumesBefore,
          backupPlaintextStaging: backupStagingBefore,
          completion: marker,
        };
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    throw new Error('Partial reset target detected without a valid completion marker');
  }

  const backup = await validateMarker(backupMarker);
  const runtime = await runtimeReady();
  const backupVerification = await backupGate.verify(backup.snapshotId);
  try {
    await lstat(credentialFile);
    throw new Error('Credential file already exists and does not match the target agent');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  await removeCompletion(completionMarker);
  const garageSession = await objectStore.beginReset();
  let volumeSession;
  try {
    volumeSession = await volumeStore.beginReset(garageSession.stage);
  } catch (error) {
    await objectStore.rollback(garageSession);
    throw error;
  }
  const rollbackPreCommit = async () => {
    await volumeStore.rollback(volumeSession);
    await objectStore.rollback(garageSession);
  };
  const masterKey = createKey();
  try {
    if (!/^itp_[A-Za-z]{64}$/.test(masterKey)) throw new Error('Generated master key is invalid');
    await writeCredential(credentialFile, masterKey);
  } catch (error) {
    await removeCredential(credentialFile);
    await rollbackPreCommit();
    throw error;
  }
  let committed = false;
  try {
    const ownerId = before.facts.ownerId;
    if (typeof ownerId !== 'string' || before.facts.ownerMatches !== 1 || !before.facts.ownerGod) {
      throw new Error('The configured owner is missing or is not the instance owner');
    }
    const agentUserId = randomUUID();
    await database.reset({
      ownerId,
      agentUserId,
      agentEmail: `${agentUserId}@agents.local`,
      apiKeyId: randomUUID(),
      apiKeyHash: hashMasterKey(masterKey),
    });
    committed = true;
  } finally {
    if (!committed) {
      await removeCredential(credentialFile);
      await rollbackPreCommit();
    }
  }

  try {
    const after = await database.inventory();
    if (!isTargetState(after)) throw new Error('Post-reset target verification failed');
    if (!(await database.keyMatches(hashMasterKey(masterKey)))) {
      throw new Error('Post-reset credential verification failed');
    }
    const residualVolumes = await volumeStore.verifyFresh();
    const garage = await objectStore.verifyFresh();
    await objectStore.complete(garageSession);
    const completion = await writeComplete(completionMarker, {
      backup,
      backupVerification,
      database: after,
      garage,
      volumes: residualVolumes,
      runtime,
    });
    return {
      mode: 'apply',
      changed: true,
      after: summarizeInventory(after),
      garage,
      residualVolumes,
      backupVerification,
      completion,
    };
  } catch (error) {
    await removeCompletion(completionMarker);
    await objectStore.failClosed();
    throw error;
  }
}

function printReport(report, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  const inventory = report.after ?? report.before;
  console.log(`Plan fresh reset v${RESET_VERSION}: ${report.mode}`);
  console.log(`Target state: ${inventory.target ? 'yes' : 'no'}`);
  for (const [name, value] of Object.entries(inventory.counts)) console.log(`${name}: ${value}`);
  if ('changed' in report) console.log(`Changed: ${report.changed ? 'yes' : 'no'}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const report = await runFreshReset(options, { database: createDockerDatabase() });
    printReport(report, options.json);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Fresh reset failed');
    process.exitCode = 1;
  }
}
