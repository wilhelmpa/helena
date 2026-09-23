import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import {
  createEncryptedBackupGate,
  hashMasterKey,
  isTargetState,
  parseArgs,
  replaceEnvironmentValues,
  resetSql,
  runFreshReset,
  validateBackupMarker,
  validateCompletionMarker,
  writeCompletionMarker,
  writeCredentialOnce,
} from '../fresh-reset.mjs';

const EMPTY_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const SNAPSHOT_ID = 'a'.repeat(64);
const NEW_SNAPSHOT_ID = 'b'.repeat(64);

function populatedGarage() {
  return { bucket: 'planner-attachments', count: 19, totalBytes: 917987, sha256: 'b'.repeat(64) };
}

function emptyGarage() {
  return { bucket: 'planner-attachments', count: 0, totalBytes: 0, sha256: EMPTY_SHA };
}

function objectStoreMock({ before = populatedGarage(), verify = emptyGarage(), calls = [] } = {}) {
  return {
    inventory: async () => before,
    beginReset: async () => {
      calls.push('garage.begin');
      return { stage: 'test-stage' };
    },
    rollback: async () => calls.push('garage.rollback'),
    verifyFresh: async () => {
      calls.push('garage.verify');
      if (verify.count !== 0 || verify.totalBytes !== 0 || verify.sha256 !== EMPTY_SHA) {
        throw new Error('Post-reset Garage manifest is not empty');
      }
      return verify;
    },
    complete: async () => calls.push('garage.complete'),
    failClosed: async () => calls.push('garage.failClosed'),
  };
}

function populatedVolumes() {
  return { dbBackupEntries: 6, legacyMinioEntries: 100 };
}

function emptyVolumes() {
  return { dbBackupEntries: 0, legacyMinioEntries: 0 };
}

function volumeStoreMock({ before = populatedVolumes(), verify = emptyVolumes(), calls = [] } = {}) {
  return {
    inventory: async () => before,
    beginReset: async (stage) => {
      calls.push(`volumes.begin:${stage}`);
      return { stage };
    },
    rollback: async () => calls.push('volumes.rollback'),
    verifyFresh: async () => {
      calls.push('volumes.verify');
      if (verify.dbBackupEntries !== 0 || verify.legacyMinioEntries !== 0) {
        throw new Error('Post-reset Plan residual Docker volumes are not empty');
      }
      return verify;
    },
  };
}

function backupGateMock(calls = []) {
  return {
    inventory: async () => ({ entryCount: 0, empty: true }),
    verify: async (snapshotId) => {
      calls.push(`backup.verify:${snapshotId}`);
      return { snapshotId, restoreVerified: true, plaintextStagingEmpty: true };
    },
  };
}

const temporary = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function beforeInventory() {
  return {
    counts: new Map([
      ['user', 15],
      ['team', 2],
      ['project', 5],
      ['project_member', 42],
      ['team_member', 16],
      ['team_role', 8],
      ['ai_agent', 14],
      ['apikey', 15],
      ['issue', 78],
      ['project_document', 34],
      ['cycle', 1],
    ]),
    facts: {
      ownerId: 'owner-id',
      ownerMatches: 1,
      ownerGod: true,
      authSettings: 1,
      otherAppSettings: 5,
      totalUsers: 15,
      agentUsers: 14,
      homeProjects: 0,
      masterAgents: 0,
      masterMemberships: 0,
    },
  };
}

function targetInventory() {
  return {
    counts: new Map([
      ['user', 2],
      ['account', 1],
      ['app_setting', 1],
      ['app_secret', 0],
      ['team', 1],
      ['team_member', 2],
      ['team_role', 1],
      ['project', 1],
      ['project_member', 2],
      ['ai_agent', 1],
      ['apikey', 1],
      ['issue', 0],
      ['project_document', 0],
      ['cycle', 0],
      ['agent_run', 0],
      ['agent_schedule', 0],
      ['agent_skill', 0],
      ['integration_credential', 0],
      ['mastra_agents', 0],
      ['mastra_schedules', 0],
      ['mastra_workflow_snapshot', 0],
    ]),
    facts: {
      ownerId: 'owner-id',
      ownerMatches: 1,
      ownerGod: true,
      authSettings: 1,
      otherAppSettings: 0,
      totalUsers: 2,
      agentUsers: 1,
      homeProjects: 1,
      masterAgents: 1,
      masterMemberships: 1,
    },
  };
}

function operationalTargetInventory() {
  const inventory = targetInventory();
  inventory.counts.set('hub_inbox_event', 34);
  inventory.counts.set('hub_inbox_source', 3);
  inventory.counts.set('hub_inbox_thread', 32);
  inventory.counts.set('revision', 1);
  inventory.counts.set('user_preference', 1);
  return inventory;
}

test('destructive mode requires both explicit acknowledgements', () => {
  assert.deepEqual(parseArgs([]), {
    apply: false,
    json: false,
    reattest: false,
    confirm: '',
    backupMarker: '',
  });
  assert.throws(() => parseArgs(['--reattest']), /valid only with --apply/);
  assert.throws(() => parseArgs(['--apply']), /--confirm RESET_PLAN_TO_HOME/);
  assert.throws(
    () => parseArgs(['--apply', '--confirm', 'RESET_PLAN_TO_HOME']),
    /--backup-marker/,
  );
  assert.throws(() => parseArgs(['--unknown']), /Unknown argument/);
});

test('backup marker must be recent, private and valid', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fresh-reset-marker-'));
  temporary.push(root);
  const marker = join(root, 'last-success');
  const now = new Date('2026-09-22T10:00:00Z');
  await writeFile(
    marker,
    `${JSON.stringify({ schemaVersion: 1, completedAt: '2026-09-22T09:30:00Z', snapshotId: SNAPSHOT_ID, restoreProbeVerified: true, plaintextStagingEmpty: true })}\n`,
    { mode: 0o600 },
  );
  assert.deepEqual(await validateBackupMarker(marker, { now }), {
    completedAt: '2026-09-22T09:30:00Z',
    snapshotId: SNAPSHOT_ID,
    restoreProbeVerified: true,
    plaintextStagingEmpty: true,
    maxAgeHours: 24,
  });
  await chmod(marker, 0o622);
  await assert.rejects(() => validateBackupMarker(marker, { now }), /group\/world writable/);
  await chmod(marker, 0o600);
  await writeFile(
    marker,
    JSON.stringify({ schemaVersion: 1, completedAt: '2026-09-20T09:30:00Z', snapshotId: SNAPSHOT_ID, restoreProbeVerified: true, plaintextStagingEmpty: true }),
  );
  await assert.rejects(() => validateBackupMarker(marker, { now }), /stale or invalid/);
});

test('Garage environment rotation replaces exactly the two required keys', () => {
  const source = 'A=1\nGARAGE_ACCESS_KEY_ID=old\nGARAGE_SECRET_ACCESS_KEY=old-secret\nZ=2\n';
  const next = replaceEnvironmentValues(source, {
    GARAGE_ACCESS_KEY_ID: 'GKnew',
    GARAGE_SECRET_ACCESS_KEY: 'new-secret',
  });
  assert.equal(next, 'A=1\nGARAGE_ACCESS_KEY_ID=GKnew\nGARAGE_SECRET_ACCESS_KEY=new-secret\nZ=2\n');
  assert.throws(
    () => replaceEnvironmentValues('GARAGE_ACCESS_KEY_ID=old\n', {
      GARAGE_ACCESS_KEY_ID: 'new',
      GARAGE_SECRET_ACCESS_KEY: 'new-secret',
    }),
    /Missing environment key/,
  );
});

test('target state permits only the owner, HOME project and master agent rows', () => {
  assert.equal(isTargetState(targetInventory()), true);
  const residual = targetInventory();
  residual.counts.set('project_document', 1);
  assert.equal(isTargetState(residual), false);
  const secret = targetInventory();
  secret.counts.set('app_secret', 1);
  assert.equal(isTargetState(secret), false);
  const setting = targetInventory();
  setting.facts.otherAppSettings = 1;
  assert.equal(isTargetState(setting), false);
  const extraUser = targetInventory();
  extraUser.facts.totalUsers = 3;
  assert.equal(isTargetState(extraUser), false);
});

test('reset SQL is transactional, clears future domain tables and contains only the key hash', () => {
  const secret = `itp_${'S'.repeat(64)}`;
  const hash = hashMasterKey(secret);
  const sql = resetSql({
    ownerId: 'owner-id',
    agentUserId: '00000000-0000-4000-8000-000000000001',
    agentEmail: '00000000-0000-4000-8000-000000000001@agents.local',
    apiKeyId: '00000000-0000-4000-8000-000000000002',
    apiKeyHash: hash,
  });
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /TRUNCATE TABLE/);
  assert.match(sql, /ACCESS EXCLUSIVE MODE/);
  assert.match(sql, /COMMIT;\n$/);
  assert.match(sql, new RegExp(hash));
  assert.equal(sql.includes(secret), false);
  assert.match(sql, /tablename NOT IN \('account', 'app_setting'/);
  assert.match(sql, /DELETE FROM app_setting WHERE key <> 'auth'/);
  assert.equal(sql.includes("'app_secret', 'app_setting'"), false);
});

test('dry-run inventories without writing', async () => {
  let reset = false;
  const report = await runFreshReset(
    { apply: false },
    {
      database: {
        inventory: async () => beforeInventory(),
        reset: async () => {
          reset = true;
        },
      },
      objectStore: objectStoreMock(),
      volumeStore: volumeStoreMock(),
      backupGate: backupGateMock(),
    },
  );
  assert.equal(report.mode, 'dry-run');
  assert.equal(report.before.counts.projects, 5);
  assert.equal(report.garage.count, 19);
  assert.deepEqual(report.residualVolumes, populatedVolumes());
  assert.equal(report.backupPlaintextStaging.empty, true);
  assert.equal(reset, false);
});

test('failed exact-snapshot restore gate prevents every mutation', async () => {
  const calls = [];
  await assert.rejects(
    () => runFreshReset(
      { apply: true },
      {
        database: { inventory: async () => beforeInventory() },
        validateMarker: async () => ({ snapshotId: SNAPSHOT_ID }),
        runtimeReady: async () => calls.push('runtime.ready'),
        objectStore: objectStoreMock({ calls }),
        volumeStore: volumeStoreMock({ calls }),
        backupGate: {
          inventory: async () => ({ entryCount: 0, empty: true }),
          verify: async () => {
            calls.push('backup.failed');
            throw new Error('restore probe failed');
          },
        },
        removeCompletion: async () => calls.push('completion.remove'),
      },
    ),
    /restore probe failed/,
  );
  assert.deepEqual(calls, ['runtime.ready', 'backup.failed']);
});

test('backup gate proves the exact snapshot and restores both protected artifacts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fresh-reset-restic-gate-'));
  temporary.push(root);
  await mkdir(join(root, 'current'), { mode: 0o700 });
  const commands = [];
  const command = async (name, args) => {
    commands.push([name, ...args]);
    if (name === 'restic' && args[0] === 'snapshots') {
      return { stdout: JSON.stringify([{ id: SNAPSHOT_ID }]) };
    }
    if (name === 'restic' && args[0] === 'restore') {
      const target = args[args.indexOf('--target') + 1];
      await mkdir(`${target}/probe`, { recursive: true, mode: 0o700 });
      await writeFile(
        `${target}/probe/database-counts.json`,
        JSON.stringify({ plan: '1,2,3,4,5', nextcloud: '1,2,3' }),
        { mode: 0o600 },
      );
      await writeFile(`${target}/probe/plan-residual-volumes.tar`, 'test archive', {
        mode: 0o600,
      });
      return { stdout: '' };
    }
    if (name === 'tar') {
      return { stdout: './itsaplan-db-backups/history.dump\n./itsaplan-minio-data/.minio.sys/\n' };
    }
    throw new Error(`Unexpected command: ${name}`);
  };
  const gate = createEncryptedBackupGate(command, {
    repository: join(root, 'repo'),
    passwordFile: join(root, 'password'),
    cacheDir: join(root, 'cache'),
    restoreProbePath: '/probe/database-counts.json',
    residualBackupPath: '/probe/plan-residual-volumes.tar',
    restoreParent: `${root}/`,
    plaintextStage: join(root, 'current'),
  });
  assert.deepEqual(await gate.verify(SNAPSHOT_ID), {
    snapshotId: SNAPSHOT_ID,
    restoreVerified: true,
    plaintextStagingEmpty: true,
  });
  assert.deepEqual(commands.map(([name, action]) => `${name}:${action}`), [
    'restic:snapshots',
    'restic:restore',
    'tar:-tf',
  ]);
});

test('apply writes one credential, resets once and verifies the exact target', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fresh-reset-apply-'));
  temporary.push(root);
  const credential = join(root, 'master-key');
  const knownKey = `itp_${'A'.repeat(64)}`;
  let inventoryCalls = 0;
  let resetInput;
  let markerChecks = 0;
  let runtimeChecks = 0;
  const calls = [];
  const database = {
    inventory: async () => (++inventoryCalls === 1 ? beforeInventory() : targetInventory()),
    reset: async (value) => {
      resetInput = value;
    },
    keyMatches: async (hash) => hash === resetInput.apiKeyHash,
  };
  const report = await runFreshReset(
    { apply: true },
    {
      database,
      backupMarker: join(root, 'marker'),
      credentialFile: credential,
      validateMarker: async () => {
        markerChecks += 1;
        return { completedAt: '2026-09-22T09:30:00Z', snapshotId: SNAPSHOT_ID };
      },
      runtimeReady: async () => {
        runtimeChecks += 1;
        return { homeSystemScopeReady: true, homeChatProjectKey: 'HOME' };
      },
      createKey: () => knownKey,
      writeCredential: writeCredentialOnce,
      objectStore: objectStoreMock({ calls }),
      volumeStore: volumeStoreMock({ calls }),
      backupGate: backupGateMock(calls),
      removeCompletion: async () => calls.push('completion.remove'),
      writeComplete: async (_path, value) => {
        calls.push('completion.write');
        assert.equal(value.backup.snapshotId, SNAPSHOT_ID);
        assert.equal(value.backupVerification.plaintextStagingEmpty, true);
        assert.deepEqual(value.volumes, emptyVolumes());
        assert.equal(value.runtime.homeChatProjectKey, 'HOME');
        return { schemaVersion: 1 };
      },
    },
  );
  assert.equal(report.changed, true);
  assert.equal(markerChecks, 1);
  assert.equal(runtimeChecks, 1);
  assert.equal(await readFile(credential, 'utf8'), knownKey);
  assert.equal(resetInput.apiKeyHash, hashMasterKey(knownKey));
  assert.equal(JSON.stringify(report).includes(knownKey), false);
  assert.deepEqual(calls, [
    `backup.verify:${SNAPSHOT_ID}`,
    'completion.remove',
    'garage.begin',
    'volumes.begin:test-stage',
    'volumes.verify',
    'garage.verify',
    'garage.complete',
    'completion.write',
  ]);
});

test('an exact target with its credential is an idempotent no-op', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fresh-reset-noop-'));
  temporary.push(root);
  const credential = join(root, 'master-key');
  const knownKey = `itp_${'B'.repeat(64)}`;
  await writeCredentialOnce(credential, knownKey);
  let reset = false;
  const report = await runFreshReset(
    { apply: true },
    {
      database: {
        inventory: async () => targetInventory(),
        reset: async () => {
          reset = true;
        },
        keyMatches: async (hash) => hash === hashMasterKey(knownKey),
      },
      credentialFile: credential,
      completionMarker: join(root, 'complete'),
      objectStore: objectStoreMock({ before: emptyGarage() }),
      volumeStore: volumeStoreMock({ before: emptyVolumes() }),
      backupGate: backupGateMock(),
      validateComplete: async () => ({ schemaVersion: 1 }),
      validateMarker: async () => assert.fail('marker must not be needed for a no-op'),
      runtimeReady: async () => assert.fail('runtime check must not be needed for a no-op'),
    },
  );
  assert.equal(report.changed, false);
  assert.equal(report.reattested, false);
  assert.equal(reset, false);
});

test('a verified operational target re-attests only the completion marker to a new snapshot', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fresh-reset-reattest-'));
  temporary.push(root);
  const credential = join(root, 'master-key');
  const completionMarker = join(root, 'complete.json');
  const knownKey = `itp_${'R'.repeat(64)}`;
  const completedAt = '2026-09-22T12:07:49Z';
  await writeCredentialOnce(credential, knownKey);
  await writeCompletionMarker(completionMarker, {
    backup: { snapshotId: SNAPSHOT_ID },
    backupVerification: {
      snapshotId: SNAPSHOT_ID,
      restoreVerified: true,
      plaintextStagingEmpty: true,
    },
    database: targetInventory(),
    garage: emptyGarage(),
    volumes: emptyVolumes(),
    runtime: { homeSystemScopeReady: true, homeChatProjectKey: 'HOME' },
    completedAt,
  });
  const calls = [];
  const report = await runFreshReset(
    { apply: true, reattest: true },
    {
      database: {
        inventory: async () => operationalTargetInventory(),
        reset: async () => assert.fail('database must not be reset during re-attestation'),
        keyMatches: async (hash) => hash === hashMasterKey(knownKey),
        validateReattestation: async (cutoff) => {
          calls.push(`operational.verify:${cutoff}`);
          return { valid: true };
        },
      },
      backupMarker: join(root, 'last-success'),
      credentialFile: credential,
      completionMarker,
      validateMarker: async () => ({ snapshotId: NEW_SNAPSHOT_ID }),
      objectStore: objectStoreMock({ before: emptyGarage() }),
      volumeStore: volumeStoreMock({ before: emptyVolumes() }),
      backupGate: {
        inventory: async () => ({ entryCount: 0, empty: true }),
        verify: async (snapshotId) => {
          calls.push(`backup.verify:${snapshotId}`);
          return { snapshotId, restoreVerified: true, plaintextStagingEmpty: true };
        },
      },
    },
  );
  assert.equal(report.changed, false);
  assert.equal(report.reattested, true);
  assert.equal(report.completion.completedAt, completedAt);
  assert.equal(report.completion.backupSnapshotId, NEW_SNAPSHOT_ID);
  assert.equal(report.completion.previousBackupSnapshotId, SNAPSHOT_ID);
  assert.deepEqual(calls, [
    `operational.verify:${completedAt}`,
    `backup.verify:${NEW_SNAPSHOT_ID}`,
  ]);
  assert.deepEqual(await validateCompletionMarker(completionMarker), report.completion);
});

test('re-attestation rejects a tampered old completion marker before checking a new backup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fresh-reset-reattest-tamper-'));
  temporary.push(root);
  const credential = join(root, 'master-key');
  const knownKey = `itp_${'T'.repeat(64)}`;
  await writeCredentialOnce(credential, knownKey);
  let newBackupChecked = false;
  await assert.rejects(
    () => runFreshReset(
      { apply: true, reattest: true },
      {
        database: {
          inventory: async () => targetInventory(),
          keyMatches: async (hash) => hash === hashMasterKey(knownKey),
        },
        credentialFile: credential,
        objectStore: objectStoreMock({ before: emptyGarage() }),
        volumeStore: volumeStoreMock({ before: emptyVolumes() }),
        backupGate: backupGateMock(),
        validateComplete: async () => {
          throw new Error('completion marker tampered');
        },
        validateMarker: async () => {
          newBackupChecked = true;
        },
      },
    ),
    /completion marker tampered/,
  );
  assert.equal(newBackupChecked, false);
});

test('re-attestation rejects a stale new backup marker without changing completion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fresh-reset-reattest-stale-'));
  temporary.push(root);
  const credential = join(root, 'master-key');
  const knownKey = `itp_${'S'.repeat(64)}`;
  await writeCredentialOnce(credential, knownKey);
  let gateChecked = false;
  await assert.rejects(
    () => runFreshReset(
      { apply: true, reattest: true },
      {
        database: {
          inventory: async () => targetInventory(),
          keyMatches: async (hash) => hash === hashMasterKey(knownKey),
        },
        credentialFile: credential,
        objectStore: objectStoreMock({ before: emptyGarage() }),
        volumeStore: volumeStoreMock({ before: emptyVolumes() }),
        validateComplete: async () => ({
          completedAt: '2026-09-22T12:07:49Z',
          backupSnapshotId: SNAPSHOT_ID,
        }),
        validateMarker: async () => {
          throw new Error('Encrypted backup marker is stale or invalid');
        },
        backupGate: {
          inventory: async () => ({ entryCount: 0, empty: true }),
          verify: async () => {
            gateChecked = true;
          },
        },
      },
    ),
    /stale or invalid/,
  );
  assert.equal(gateChecked, false);
});

test('re-attestation rejects missing exact restore verification and unsafe operational rows', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fresh-reset-reattest-gate-'));
  temporary.push(root);
  const credential = join(root, 'master-key');
  const knownKey = `itp_${'G'.repeat(64)}`;
  await writeCredentialOnce(credential, knownKey);
  const base = {
    credentialFile: credential,
    objectStore: objectStoreMock({ before: emptyGarage() }),
    volumeStore: volumeStoreMock({ before: emptyVolumes() }),
    validateComplete: async () => ({
      completedAt: '2026-09-22T12:07:49Z',
      backupSnapshotId: SNAPSHOT_ID,
    }),
    validateMarker: async () => ({ snapshotId: NEW_SNAPSHOT_ID }),
  };
  let completionWritten = false;
  await assert.rejects(
    () => runFreshReset(
      { apply: true, reattest: true },
      {
        ...base,
        database: {
          inventory: async () => targetInventory(),
          keyMatches: async (hash) => hash === hashMasterKey(knownKey),
        },
        backupGate: {
          inventory: async () => ({ entryCount: 0, empty: true }),
          verify: async () => ({
            snapshotId: NEW_SNAPSHOT_ID,
            restoreVerified: false,
            plaintextStagingEmpty: true,
          }),
        },
        writeReattested: async () => {
          completionWritten = true;
        },
      },
    ),
    /verification did not succeed/,
  );
  assert.equal(completionWritten, false);

  await assert.rejects(
    () => runFreshReset(
      { apply: true, reattest: true },
      {
        ...base,
        database: {
          inventory: async () => operationalTargetInventory(),
          keyMatches: async (hash) => hash === hashMasterKey(knownKey),
          validateReattestation: async () => {
            throw new Error('unsafe operational reference');
          },
        },
        backupGate: backupGateMock(),
      },
    ),
    /unsafe operational reference/,
  );
});

test('a failed database transaction removes the newly staged credential', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fresh-reset-failure-'));
  temporary.push(root);
  const credential = join(root, 'master-key');
  const calls = [];
  await assert.rejects(
    () =>
      runFreshReset(
        { apply: true },
        {
          database: {
            inventory: async () => beforeInventory(),
            reset: async () => {
              throw new Error('transaction failed');
            },
          },
          backupMarker: join(root, 'marker'),
          credentialFile: credential,
          validateMarker: async () => ({ snapshotId: SNAPSHOT_ID }),
          runtimeReady: async () => undefined,
          createKey: () => `itp_${'C'.repeat(64)}`,
          writeCredential: writeCredentialOnce,
          objectStore: objectStoreMock({ calls }),
          volumeStore: volumeStoreMock({ calls }),
          backupGate: backupGateMock(calls),
          removeCompletion: async () => calls.push('completion.remove'),
        },
      ),
    /transaction failed/,
  );
  await assert.rejects(() => readFile(credential), (error) => error.code === 'ENOENT');
  assert.deepEqual(calls, [
    `backup.verify:${SNAPSHOT_ID}`,
    'completion.remove',
    'garage.begin',
    'volumes.begin:test-stage',
    'volumes.rollback',
    'garage.rollback',
  ]);
});

test('completion marker attests the database and empty Garage without secrets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fresh-reset-complete-'));
  temporary.push(root);
  const markerPath = join(root, 'plan-reset.complete.json');
  const marker = await writeCompletionMarker(markerPath, {
    backup: { snapshotId: SNAPSHOT_ID },
    backupVerification: {
      snapshotId: SNAPSHOT_ID,
      restoreVerified: true,
      plaintextStagingEmpty: true,
    },
    database: targetInventory(),
    garage: emptyGarage(),
    volumes: emptyVolumes(),
    runtime: { homeSystemScopeReady: true, homeChatProjectKey: 'HOME' },
    completedAt: '2026-09-22T10:00:00Z',
  });
  assert.equal(marker.planDatabaseEmpty, true);
  assert.equal(marker.resetVersion, 'fresh-2026-09-22-v1');
  assert.equal(marker.scriptVersion, 'plan-fresh-reset-2026-09-22.2');
  assert.equal(marker.garageReset, true);
  assert.equal(marker.garageCredentialsRotated, true);
  assert.equal(marker.garageBucket, 'planner-attachments');
  assert.equal(marker.garageObjectCount, 0);
  assert.equal(marker.backupSnapshotId, SNAPSHOT_ID);
  assert.equal(marker.planDbBackupsRemoved, true);
  assert.equal(marker.legacyMinioVolumeRemoved, true);
  assert.equal(marker.planDbBackupVolumeCount, 0);
  assert.equal(marker.legacyMinioObjectCount, 0);
  assert.equal(marker.backupRestoreVerified, true);
  assert.equal(marker.backupPlaintextStagingEmpty, true);
  assert.equal(marker.homeSystemScopeReady, true);
  assert.equal(marker.homeChatProjectKey, 'HOME');
  assert.equal(marker.visibleProjectCount, 0);
  assert.equal(marker.ownerCount, 1);
  assert.equal(marker.userDataEmpty, true);
  assert.equal(marker.databaseCounts.appSecrets, 0);
  assert.equal(marker.databaseCounts.authSettings, 1);
  assert.equal(marker.databaseCounts.otherAppSettings, 0);
  const raw = await readFile(markerPath, 'utf8');
  assert.equal(raw.includes('GARAGE_SECRET'), false);
  assert.equal(raw.includes('itp_'), false);
  assert.equal((await stat(markerPath)).mode & 0o077, 0);
  assert.deepEqual(await validateCompletionMarker(markerPath), marker);
  await writeFile(
    markerPath,
    `${JSON.stringify({
      ...marker,
      databaseCounts: { ...marker.databaseCounts, tasks: 1 },
    })}\n`,
    { mode: 0o600 },
  );
  await assert.rejects(
    () => validateCompletionMarker(markerPath),
    /invalid schema or state/,
  );
});

test('post-commit Garage verification failure leaves no marker and stops writers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fresh-reset-postcommit-'));
  temporary.push(root);
  const credential = join(root, 'master-key');
  const calls = [];
  let inventoryCalls = 0;
  await assert.rejects(
    () => runFreshReset(
      { apply: true },
      {
        database: {
          inventory: async () => (++inventoryCalls === 1 ? beforeInventory() : targetInventory()),
          reset: async () => undefined,
          keyMatches: async () => true,
        },
        backupMarker: join(root, 'marker'),
        credentialFile: credential,
        completionMarker: join(root, 'complete'),
        validateMarker: async () => ({ snapshotId: SNAPSHOT_ID }),
        runtimeReady: async () => undefined,
        createKey: () => `itp_${'D'.repeat(64)}`,
        writeCredential: writeCredentialOnce,
        objectStore: objectStoreMock({ calls, verify: populatedGarage() }),
        volumeStore: volumeStoreMock({ calls }),
        backupGate: backupGateMock(calls),
        removeCompletion: async () => calls.push('completion.remove'),
      },
    ),
    /Garage manifest is not empty/,
  );
  assert.deepEqual(calls, [
    `backup.verify:${SNAPSHOT_ID}`,
    'completion.remove',
    'garage.begin',
    'volumes.begin:test-stage',
    'volumes.verify',
    'garage.verify',
    'completion.remove',
    'garage.failClosed',
  ]);
});
