#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const SCRIPT_VERSION = 'factory-first-run-2';
export const CONFIRM_PHRASE = 'ERASE_ALL_VOLITION_DATA_AND_ACCESS';

const HOME = '/home/pw';
const PLAN_ROOT = '/home/pw/services/itsaplan';
const STACK_ROOT = '/home/pw/services/volition-stack';
const BACKUP_ROOT = '/home/pw/services/volition-backups';
const UNIT_ROOT = '/home/pw/.config/systemd/user';
const PLAN_ENV = `${PLAN_ROOT}/.env`;
const STACK_ENV = `${STACK_ROOT}/.env`;
const PLAN_COMPOSE = `${PLAN_ROOT}/docker-compose.yml`;
const HUB_COMPOSE = `${STACK_ROOT}/compose.hub.yml`;
const APPS_COMPOSE = `${STACK_ROOT}/compose.apps.yml`;
const VAULT_COMPOSE = `${STACK_ROOT}/compose.vault.yml`;
const GATEWAY_COMPOSE = `${STACK_ROOT}/compose.gateway.yml`;
const FACTORY_GATEWAY_ROUTES = Object.freeze(['plan-api.volition.one', 'plan.volition.one', 'vault.volition.one']);

export const PLAN_PUBLIC_TABLES = Object.freeze([
  'account', 'agent_chat_catalog', 'agent_chat_event', 'agent_chat_favorite',
  'agent_chat_message', 'agent_chat_thread', 'agent_chat_usage', 'agent_field_trigger',
  'agent_run', 'agent_skill', 'agent_skill_link', 'agent_tool',
  'agent_tool_link', 'ai_agent', 'apikey', 'app_secret', 'app_setting',
  'chat_attachment', 'custom_field', 'custom_field_option', 'cycle',
  'git_managed_repository', 'git_provider_connection', 'hub_inbox_event',
  'hub_inbox_source', 'hub_inbox_thread', 'initiative', 'initiative_attachment',
  'initiative_label', 'integration_credential', 'issue', 'issue_activity',
  'issue_attachment', 'issue_checklist', 'issue_checklist_item', 'issue_cycle',
  'issue_development_check', 'issue_development_link', 'issue_field_option',
  'issue_field_value', 'issue_import', 'issue_label', 'issue_link', 'issue_status',
  'issue_template', 'issue_template_label', 'issue_type', 'issue_watcher',
  'issue_worklog', 'label', 'label_group', 'note_board', 'note_board_member', 'notification',
  'notification_delivery', 'oauth_access_token', 'oauth_application', 'oauth_consent',
  'organization_agent_assignment', 'organization_department', 'organization_goal',
  'organization_project_assignment', 'passkey', 'project', 'project_action',
  'project_action_run', 'project_action_run_step', 'project_column', 'project_dashboard',
  'project_member',
  'project_notification_setting', 'project_provisioning_job', 'project_setting',
  'project_template', 'project_view', 'project_view_favorite', 'project_view_folder',
  'project_workflow_assignment', 'revision', 'scim_group', 'scim_group_mapping',
  'scim_group_member', 'session', 'team', 'team_invite', 'team_member',
  'team_notification_setting', 'team_role', 'user', 'user_notification_preference',
  'user_preference', 'user_telegram_account', 'vault_entry', 'vault_link', 'vault_move',
  'verification', 'webhook', 'webhook_delivery',
].sort());

export const HERMES_BASELINE_UNITS = Object.freeze([
  'volition-hermes-bootstrap.service',
  'volition-hermes-bootstrap.timer',
]);

export const APP_UNITS = Object.freeze([
  'volition-artifact-sync.service', 'volition-artifact-sync.timer',
  'volition-backup.service', 'volition-backup.timer',
  'volition-browser-chromium.service', 'volition-browser-ensure.service',
  'volition-browser-ensure.timer', 'volition-browser-novnc.service',
  'volition-browser-vnc.service', 'volition-browser-xvfb.service',
  ...HERMES_BASELINE_UNITS,
  'volition-hermes-runner.service', 'volition-integration-audit.service',
  'volition-offsite.service', 'volition-offsite.timer', 'volition-provisioning.service',
  'volition-standalone-browser.target',
]);

export const DATA_VOLUMES = Object.freeze([
  'itsaplan_db-backups',
  'itsaplan_minio-data',
  'itsaplan_web-cache',
  'volition-apps_nextcloud_data',
  'volition-apps_nextcloud_db',
  'volition-apps_nextcloud_html',
  'volition-apps_nextcloud_redis',
  'volition-apps_workspace_home',
  'volition-nextcloud-db-alpine-20260921-v2',
  'volition-nextcloud-redis-alpine-20260921-v2',
]);

export const SECRET_FILES = Object.freeze([
  'backup_restic_password', 'inbox_push_token', 'itsaplan_home_master_agent_api_key',
  'nextcloud_admin_password', 'nextcloud_db_password',
  'nextcloud_patrick_app_password', 'hermes_checkpoint_age_identity',
  'hermes_checkpoint_age_recipient', 'plan_control_token', 'redis_password', 'trading_bridge_token',
  'verve_git_deploy_key', 'verve_git_deploy_key.pub',
].map((name) => `${STACK_ROOT}/.secrets/${name}`));
export const EXPECTED_SECRET_BASENAMES = Object.freeze([
  'backup_restic_password', 'github_known_hosts', 'inbox_push_token',
  'itsaplan_home_master_agent_api_key',
  'nextcloud_admin_password', 'nextcloud_db_password', 'nextcloud_patrick_app_password',
  'hermes_checkpoint_age_identity', 'hermes_checkpoint_age_recipient',
  'plan_control_token', 'redis_password', 'trading_bridge_token',
  'verve_git_deploy_key', 'verve_git_deploy_key.pub',
].sort());
export const POST_RESET_SECRET_BASENAMES = Object.freeze([
  'github_known_hosts',
  'plan_control_token',
]);

export const CLEAR_DIRECTORIES = Object.freeze([
  `${STACK_ROOT}/garage/meta`, `${STACK_ROOT}/garage/data`,
  `${STACK_ROOT}/data/hermes`, `${STACK_ROOT}/browser/profile`,
  `${STACK_ROOT}/browser/cache`, `${STACK_ROOT}/browser/home`, `${STACK_ROOT}/browser/run`,
  `${STACK_ROOT}/.state/code-user-settings`, `${STACK_ROOT}/.state/vaultwarden`, `${STACK_ROOT}/backups`,
  `${STACK_ROOT}/reset-state`, `${STACK_ROOT}/migration/acceptance`,
  `${STACK_ROOT}/migration/checkpoints`, `${STACK_ROOT}/.staging`,
  '/home/pw/services/volition-ops/source-sync-backups',
  '/home/pw/services/volition-workspaces',
]);

export const REMOVE_PATHS = Object.freeze([
  BACKUP_ROOT, '/home/pw/.config/gh', '/home/pw/.config/itsaplan',
  `${PLAN_ROOT}/.env.pre-garage-20260921T121439`,
  `${PLAN_ROOT}/apps/web/.env`,
]);

export const REPOSITORIES = Object.freeze([
  PLAN_ROOT,
  '/home/pw/services/hermes-agent',
  '/home/pw/Projekte/Shopify/v1-cart-suite',
]);

const PLAN_ROTATED_KEYS = new Set([
  'POSTGRES_PASSWORD', 'DATABASE_URL', 'BETTER_AUTH_SECRET', 'APP_ENCRYPTION_KEY',
  'GARAGE_ACCESS_KEY_ID', 'GARAGE_SECRET_ACCESS_KEY', 'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
]);
const PLAN_CLEARED_KEYS = new Set([
  'AGENT_UI_URL', 'BROWSER_URL', 'CODE_URL', 'CONNECTIONS_INTEGRATION_TOKEN',
  'CONNECTIONS_INTEGRATION_URL', 'CONNECTIONS_URL', 'FILES_URL', 'HOME_CHAT_PROJECT_KEY', 'INBOX_ACCOUNTS',
  'INBOX_INTEGRATION_TOKEN', 'INBOX_INTEGRATION_URL', 'INBOX_TEAM_ID',
  'MASTER_AGENT_USERNAME', 'HERMES_COORDINATOR_ID', 'HERMES_PROJECT_COORDINATORS',
  'HERMES_PROVISIONING_TOKEN', 'HERMES_PROVISIONING_URL', 'HERMES_URL',
  'PAPERLESS_URL', 'TERMINAL_URL', 'PROJECT_AGENT_USERNAMES', 'PROJECT_PROVISIONING_TOKEN',
  'PROJECT_PROVISIONING_URL', 'PROJECT_WORKSPACE_PATHS',
]);
const STACK_CLEARED_KEYS = new Set([
  'CODE_PUBLIC_URL', 'HOME_CHAT_PROJECT_KEY', 'MASTER_AGENT_USERNAME', 'HERMES_BIN',
  'HERMES_PROVISIONING_TOKEN', 'HERMES_PROVISIONING_URL', 'HERMES_PUBLIC_URL',
  'HERMES_ROOT', 'PROJECT_AGENT_USERNAMES', 'PROJECT_PROVISIONING_TOKEN',
  'PROJECT_PROVISIONING_URL',
]);

export class FactoryResetError extends Error {}

export function parseArgs(argv) {
  const result = { apply: false, confirm: '', json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--apply') result.apply = true;
    else if (value === '--dry-run') result.apply = false;
    else if (value === '--json') result.json = true;
    else if (value === '--confirm') result.confirm = argv[++index] ?? '';
    else throw new FactoryResetError(`Unknown argument: ${value}`);
  }
  if (!result.apply && result.confirm) throw new FactoryResetError('--confirm requires --apply');
  if (result.apply && result.confirm !== CONFIRM_PHRASE) {
    throw new FactoryResetError(`--apply requires --confirm ${CONFIRM_PHRASE}`);
  }
  return result;
}

export function assertExactSet(actual, expected, label) {
  const left = [...actual].sort();
  const right = [...expected].sort();
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    const missing = right.filter((value) => !left.includes(value));
    const extra = left.filter((value) => !right.includes(value));
    throw new FactoryResetError(`${label} changed; missing=${missing.join(',') || '-'} extra=${extra.join(',') || '-'}`);
  }
}

export function isAcceptedSecretInventory(actual) {
  const normalized = [...actual].sort();
  return [EXPECTED_SECRET_BASENAMES, POST_RESET_SECRET_BASENAMES]
    .some((expected) => JSON.stringify(normalized) === JSON.stringify([...expected].sort()));
}

export function assertAllowedPath(path, allowlist) {
  const resolved = resolve(path);
  const allowed = new Set(allowlist.map((entry) => resolve(entry)));
  if (!allowed.has(resolved) || resolved === '/' || resolved === HOME) {
    throw new FactoryResetError(`Path is outside the exact factory-reset allowlist: ${resolved}`);
  }
  return resolved;
}

export function rewriteEnvironment(source, replacements, cleared, additions = {}) {
  const seen = new Set();
  const lines = source.split('\n').map((line) => {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=/);
    if (!match) return line;
    const key = match[1];
    if (seen.has(key)) throw new FactoryResetError(`Duplicate environment key: ${key}`);
    seen.add(key);
    if (Object.hasOwn(replacements, key)) return `${key}=${replacements[key]}`;
    if (cleared.has(key)) return `${key}=`;
    return line;
  });
  for (const key of Object.keys(replacements)) {
    if (!seen.has(key)) throw new FactoryResetError(`Required environment key is missing: ${key}`);
  }
  for (const [key, value] of Object.entries(additions)) {
    if (!seen.has(key)) lines.push(`${key}=${value}`);
  }
  return lines.join('\n');
}

function randomHex(bytes = 32) { return randomBytes(bytes).toString('hex'); }
function sqlLiteral(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function sqlIdentifier(value) {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new FactoryResetError('Unsafe database identifier');
  return `"${value}"`;
}

async function run(command, args, { input = '', allowFailure = false } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', rejectPromise);
    child.on('close', (code) => {
      const result = { code: code ?? 1, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') };
      if (result.code === 0 || allowFailure) resolvePromise(result);
      else rejectPromise(new FactoryResetError(`${command} failed with exit code ${result.code}`));
    });
    child.stdin.end(input);
  });
}

async function exists(path) {
  try { await lstat(path); return true; } catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
}

export function dockerDirectoryCleanupArgs(path, allowlist) {
  const safe = assertAllowedPath(path, allowlist);
  return [
    'run', '--rm', '--network', 'none', '--read-only',
    '--security-opt', 'no-new-privileges:true', '--cap-drop', 'ALL',
    '--cap-add', 'CHOWN', '--cap-add', 'DAC_OVERRIDE', '--cap-add', 'FOWNER',
    '--pids-limit', '32', '--memory', '128m', '--cpus', '0.5',
    '--entrypoint', '/bin/sh', '-v', `${safe}:/target`, 'postgres:17-alpine',
    '-ec', 'find /target -mindepth 1 -xdev -delete; chown 1000:1000 /target; chmod 700 /target',
  ];
}

async function dockerClearExactDirectory(path, allowlist) {
  const safe = assertAllowedPath(path, allowlist);
  const info = await lstat(safe);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new FactoryResetError(`Docker cleanup target is not a regular directory: ${safe}`);
  await run('/usr/bin/docker', dockerDirectoryCleanupArgs(safe, allowlist));
}

async function removeExactPath(path, allowlist) {
  const safe = assertAllowedPath(path, allowlist);
  try {
    await rm(safe, { recursive: true, force: true });
    return;
  } catch (error) {
    if (!['EACCES', 'EPERM'].includes(error?.code) || !(await exists(safe))) throw error;
  }
  await dockerClearExactDirectory(safe, allowlist);
  await rm(safe, { recursive: true, force: true });
}

async function atomicPrivateWrite(path, value) {
  const temporary = `${path}.factory-new-${process.pid}`;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(temporary, value, { mode: 0o600, flag: 'wx' });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

async function readEnv(path) {
  const source = await readFile(path, 'utf8');
  const values = new Map();
  for (const line of source.split('\n')) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (match) values.set(match[1], match[2]);
  }
  return { source, values };
}

function planComposeArgs(...args) {
  return ['compose', '--project-directory', PLAN_ROOT, '--env-file', PLAN_ENV, '-f', PLAN_COMPOSE, '-f', HUB_COMPOSE, ...args];
}

async function planTableNames() {
  const result = await run('/usr/bin/docker', ['exec', 'itsaplan-postgres-1', 'psql', '-U', 'itsaplan', '-d', 'itsaplan', '-Atqc', "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"]);
  return result.stdout.trim().split(/\s+/).filter(Boolean);
}

async function containerRunning(name) {
  const result = await run('/usr/bin/docker', ['inspect', '--format', '{{.State.Running}}', name], { allowFailure: true });
  return result.code === 0 && result.stdout.trim() === 'true';
}

async function ensurePlanDatabaseForApply() {
  if (await containerRunning('itsaplan-postgres-1')) return;
  const existing = await run('/usr/bin/docker', ['inspect', 'itsaplan-postgres-1'], { allowFailure: true });
  if (existing.code === 0) await run('/usr/bin/docker', ['start', 'itsaplan-postgres-1']);
  else await run('/usr/bin/docker', planComposeArgs('up', '-d', 'postgres'));
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const health = await run('/usr/bin/docker', ['inspect', '--format', '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}', 'itsaplan-postgres-1'], { allowFailure: true });
    if (health.stdout.trim() === 'healthy') return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
  }
  throw new FactoryResetError('Plan database did not become healthy for resume');
}

async function repositoryHeads() {
  const heads = {};
  for (const path of REPOSITORIES) {
    const result = await run('/usr/bin/git', ['-C', path, 'rev-parse', 'HEAD']);
    heads[path] = result.stdout.trim();
  }
  return heads;
}

async function stopDisableUnits() {
  for (const unit of APP_UNITS) {
    await run('/usr/bin/systemctl', ['--user', 'disable', '--now', unit], { allowFailure: true });
    await run('/usr/bin/systemctl', ['--user', 'reset-failed', unit], { allowFailure: true });
  }
}

async function removeAppUnitFiles() {
  const paths = [...APP_UNITS.map((unit) => join(UNIT_ROOT, unit)), `${UNIT_ROOT}/volition-provisioning.service.d`];
  for (const path of paths) await rm(assertAllowedPath(path, paths), { recursive: true, force: true });
  await run('/usr/bin/systemctl', ['--user', 'daemon-reload']);
}

async function stopComposeStacks() {
  await run('/usr/bin/docker', ['compose', '-f', APPS_COMPOSE, 'down', '--remove-orphans'], { allowFailure: true });
  await run('/usr/bin/docker', ['compose', '-f', `${PLAN_ROOT}/docker-compose.test.yml`, 'down', '-v', '--remove-orphans'], { allowFailure: true });
  for (const name of ['itsaplan-api-1', 'itsaplan-worker-1', 'itsaplan-web-1', 'itsaplan-garage-1']) {
    await run('/usr/bin/docker', ['stop', name], { allowFailure: true });
  }
}

async function clearVolume(name) {
  if (!DATA_VOLUMES.includes(name)) throw new FactoryResetError(`Volume is outside the allowlist: ${name}`);
  const inspect = await run('/usr/bin/docker', ['volume', 'inspect', name], { allowFailure: true });
  if (inspect.code !== 0) return;
  await run('/usr/bin/docker', ['run', '--rm', '--network', 'none', '--read-only', '--security-opt', 'no-new-privileges:true', '--pids-limit', '32', '--memory', '128m', '--cpus', '0.5', '--entrypoint', '/bin/sh', '-v', `${name}:/target`, 'postgres:17-alpine', '-ec', "find /target -mindepth 1 -xdev -delete"]);
}

async function volumeEntryCount(name) {
  if (!DATA_VOLUMES.includes(name)) throw new FactoryResetError(`Volume is outside the allowlist: ${name}`);
  const inspect = await run('/usr/bin/docker', ['volume', 'inspect', name], { allowFailure: true });
  if (inspect.code !== 0) return 0;
  const result = await run('/usr/bin/docker', ['run', '--rm', '--network', 'none', '--read-only', '--security-opt', 'no-new-privileges:true', '--pids-limit', '32', '--memory', '128m', '--cpus', '0.5', '--entrypoint', '/bin/sh', '-v', `${name}:/target:ro`, 'postgres:17-alpine', '-ec', "find /target -mindepth 1 -xdev -print | wc -l"]);
  return Number(result.stdout.trim());
}

async function clearDirectory(path) {
  const safe = assertAllowedPath(path, CLEAR_DIRECTORIES);
  await removeExactPath(safe, CLEAR_DIRECTORIES);
  await mkdir(safe, { recursive: true, mode: 0o700 });
}

async function resetPlan(planSource) {
  const old = planSource.values;
  const databaseUser = old.get('POSTGRES_USER') || 'itsaplan';
  const databaseName = old.get('POSTGRES_DB') || 'itsaplan';
  sqlIdentifier(databaseUser);
  sqlIdentifier(databaseName);
  const postgresPassword = randomHex();
  const garageAccess = `GK${randomHex(16)}`;
  const garageSecret = randomHex();
  const replacements = {
    POSTGRES_PASSWORD: postgresPassword,
    DATABASE_URL: `postgres://${databaseUser}:${postgresPassword}@localhost:${old.get('POSTGRES_PORT') || '5432'}/${databaseName}`,
    BETTER_AUTH_SECRET: randomHex(48),
    APP_ENCRYPTION_KEY: randomHex(),
    GARAGE_ACCESS_KEY_ID: garageAccess,
    GARAGE_SECRET_ACCESS_KEY: garageSecret,
    S3_ACCESS_KEY_ID: garageAccess,
    S3_SECRET_ACCESS_KEY: garageSecret,
    VAULT_UI_ENABLED: 'true',
  };
  const tables = await planTableNames();
  assertExactSet(tables, PLAN_PUBLIC_TABLES, 'Plan public-table allowlist');
  const qualified = tables.map((table) => `public.${sqlIdentifier(table)}`).join(', ');
  // The workflow engine's state (schema helena_engine) belongs to the runs removed here; the
  // API creates the schema again when it starts.
  const sql = `BEGIN;\nLOCK TABLE ${qualified} IN ACCESS EXCLUSIVE MODE;\nTRUNCATE TABLE ${qualified} RESTART IDENTITY CASCADE;\nDROP SCHEMA IF EXISTS helena_engine CASCADE;\nALTER ROLE ${sqlIdentifier(databaseUser)} PASSWORD ${sqlLiteral(postgresPassword)};\nCOMMIT;\n`;
  await run('/usr/bin/docker', ['exec', '-i', 'itsaplan-postgres-1', 'psql', '-U', databaseUser, '-d', databaseName, '-v', 'ON_ERROR_STOP=1'], { input: sql });
  await run('/usr/bin/docker', ['stop', 'itsaplan-postgres-1']);
  for (const path of [`${STACK_ROOT}/garage/meta`, `${STACK_ROOT}/garage/data`]) await clearDirectory(path);
  const garageConfig = `metadata_dir="/meta"\ndata_dir="/data"\ndb_engine="sqlite"\nreplication_factor=1\nrpc_bind_addr="0.0.0.0:3901"\nrpc_public_addr="127.0.0.1:3901"\nrpc_secret="${randomHex()}"\n[s3_api]\ns3_region="garage"\napi_bind_addr="0.0.0.0:3900"\nroot_domain=".s3.garage.localhost"\n[admin]\napi_bind_addr="0.0.0.0:3903"\nadmin_token="${randomHex()}"\nmetrics_token="${randomHex()}"\n`;
  await atomicPrivateWrite(`${STACK_ROOT}/garage/garage.toml`, garageConfig);
  const next = rewriteEnvironment(planSource.source, replacements, PLAN_CLEARED_KEYS, { SKIP_PRE_MIGRATION_BACKUP: '1' });
  await atomicPrivateWrite(PLAN_ENV, next);
}

async function resetStackEnvironment() {
  const current = await readEnv(STACK_ENV);
  const next = rewriteEnvironment(current.source, { VAULT_UI_ENABLED: 'true' }, STACK_CLEARED_KEYS);
  await atomicPrivateWrite(STACK_ENV, next);
}

async function resetGatewayConfig() {
  const path = `${STACK_ROOT}/config/gateway.json`;
  const current = JSON.parse(await readFile(path, 'utf8'));
  delete current.pushRoutes;
  assertExactSet(Object.keys(current).sort(), ['issuer', 'ownerEmail', 'port', 'routes'], 'Gateway top-level keys');
  const routes = {};
  for (const name of FACTORY_GATEWAY_ROUTES) {
    if (!current.routes?.[name]) throw new FactoryResetError(`Required gateway route is missing: ${name}`);
    routes[name] = current.routes[name];
  }
  await atomicPrivateWrite(path, `${JSON.stringify({ ...current, routes }, null, 2)}\n`);
}

async function enableVaultFirstRunSignup() {
  const source = await readFile(VAULT_COMPOSE, 'utf8');
  const matches = source.match(/SIGNUPS_ALLOWED:\s*"(?:true|false)"/g) ?? [];
  if (matches.length !== 1) throw new FactoryResetError('Vault signup setting is missing or ambiguous');
  const next = source.replace(/SIGNUPS_ALLOWED:\s*"(?:true|false)"/, 'SIGNUPS_ALLOWED: "true"');
  await atomicPrivateWrite(VAULT_COMPOSE, next);
}

async function resetSecrets() {
  for (const path of SECRET_FILES) await rm(assertAllowedPath(path, SECRET_FILES), { force: true });
  await atomicPrivateWrite(`${STACK_ROOT}/.secrets/plan_control_token`, randomHex());
}

async function removePaths() {
  for (const path of REMOVE_PATHS) await removeExactPath(path, REMOVE_PATHS);
  for (const path of CLEAR_DIRECTORIES) await clearDirectory(path);
}

async function startBlankServices() {
  await run('/usr/bin/docker', planComposeArgs('up', '-d', '--wait', '--wait-timeout', '240', 'postgres', 'garage', 'api', 'web'));
  await run('/usr/bin/docker', ['compose', '-f', VAULT_COMPOSE, 'up', '-d', '--force-recreate', '--wait', '--wait-timeout', '120', 'vaultwarden']);
  await run('/usr/bin/docker', ['compose', '-f', GATEWAY_COMPOSE, 'up', '-d', '--force-recreate', '--wait', '--wait-timeout', '120', 'gateway']);
}

async function installHermesUnderlay() {
  const integrationRoot = PLAN_ROOT + '/deployment/volition-stack/integration';
  const hermesHome = STACK_ROOT + '/data/hermes';
  const workspaceRoot = '/home/pw/services/volition-workspaces';
  await mkdir(hermesHome, { recursive: true, mode: 0o700 });
  await chmod(hermesHome, 0o700);
  await mkdir(workspaceRoot, { recursive: true, mode: 0o700 });
  await chmod(workspaceRoot, 0o700);
  await atomicPrivateWrite(
    hermesHome + '/config.yaml',
    await readFile(integrationRoot + '/hermes-runner/hermes-config.fragment.yaml', 'utf8'),
  );
  const runnerArtifact = PLAN_ROOT + '/packages/runner/dist/cli.js';
  if (!(await exists(runnerArtifact))) {
    await mkdir(dirname(runnerArtifact), { recursive: true, mode: 0o755 });
    await run('/usr/bin/docker', [
      'exec',
      'itsaplan-api-1',
      '/usr/local/bin/bun',
      'build',
      'packages/runner/src/cli.ts',
      '--target=node',
      '--outfile=/tmp/volition-hermes-runner.js',
    ]);
    await run('/usr/bin/docker', [
      'cp',
      'itsaplan-api-1:/tmp/volition-hermes-runner.js',
      runnerArtifact,
    ]);
    await run('/usr/bin/docker', [
      'exec',
      'itsaplan-api-1',
      'rm',
      '-f',
      '/tmp/volition-hermes-runner.js',
    ]);
    await chmod(runnerArtifact, 0o755);
  }
  await chmod(integrationRoot + '/scripts/volition-hermes-bootstrap', 0o700);
  await mkdir(UNIT_ROOT, { recursive: true, mode: 0o700 });
  for (const unit of ['volition-hermes-bootstrap.service', 'volition-hermes-bootstrap.timer']) {
    await atomicPrivateWrite(
      UNIT_ROOT + '/' + unit,
      await readFile(integrationRoot + '/systemd/' + unit, 'utf8'),
    );
  }
  await run('/usr/bin/systemctl', ['--user', 'daemon-reload']);
  await run('/usr/bin/systemctl', ['--user', 'enable', '--now', 'volition-hermes-bootstrap.timer']);
  await run('/usr/bin/systemctl', ['--user', 'start', 'volition-hermes-bootstrap.service']);
}

async function verifyFirstUserSource() {
  const [auth, instance] = await Promise.all([
    readFile(`${PLAN_ROOT}/packages/auth/src/index.ts`, 'utf8'),
    readFile(`${PLAN_ROOT}/packages/auth/src/instance.ts`, 'utf8'),
  ]);
  if (!instance.includes("registration: 'open'") || !auth.includes("role: isFirstUser ? 'god' : 'user'") || !auth.includes('.insert(schema.team)')) {
    throw new FactoryResetError('First-user signup source contract is not present');
  }
}

async function preflightApply({ requireDatabase = true } = {}) {
  await verifyFirstUserSource();
  const databaseRunning = await containerRunning('itsaplan-postgres-1');
  if (requireDatabase && !databaseRunning) throw new FactoryResetError('Plan database must be running for apply preflight');
  if (databaseRunning) assertExactSet(await planTableNames(), PLAN_PUBLIC_TABLES, 'Plan public-table allowlist');
  const presentSecrets = (await readdir(`${STACK_ROOT}/.secrets`, { withFileTypes: true }))
    .filter((entry) => entry.isFile() || entry.isSymbolicLink())
    .map((entry) => entry.name)
    .sort();
  if (!isAcceptedSecretInventory(presentSecrets)) {
    throw new FactoryResetError(`Service-secret allowlist changed: ${presentSecrets.join(',') || '-'}`);
  }
  const plan = await readEnv(PLAN_ENV);
  for (const key of [...PLAN_ROTATED_KEYS, 'POSTGRES_USER', 'POSTGRES_DB', 'VAULT_UI_ENABLED']) {
    if (!plan.values.has(key)) throw new FactoryResetError(`Plan environment key is missing: ${key}`);
  }
  const stack = await readEnv(STACK_ENV);
  if (!stack.values.has('VAULT_UI_ENABLED')) throw new FactoryResetError('Stack environment key is missing: VAULT_UI_ENABLED');
  const gatewayConfig = JSON.parse(await readFile(`${STACK_ROOT}/config/gateway.json`, 'utf8'));
  if (gatewayConfig.ownerEmail !== 'patrick.wilhelm@volition.one' || gatewayConfig.routes?.['plan.volition.one'] === undefined || gatewayConfig.routes?.['vault.volition.one'] === undefined) {
    throw new FactoryResetError('Plan and Vault are not protected by the exact owner gateway routes');
  }
  for (const path of ['/etc/ssh', '/etc/cloudflared', PLAN_COMPOSE, HUB_COMPOSE, APPS_COMPOSE, VAULT_COMPOSE, GATEWAY_COMPOSE, '/home/pw/services/hermes-agent/venv/bin/hermes', PLAN_ROOT + '/deployment/volition-stack/integration/scripts/volition-hermes-bootstrap', PLAN_ROOT + '/deployment/volition-stack/integration/scripts/volition-hermes-catalog.py', PLAN_ROOT + '/deployment/volition-stack/integration/systemd/volition-hermes-bootstrap.service', PLAN_ROOT + '/deployment/volition-stack/integration/systemd/volition-hermes-bootstrap.timer']) {
    if (!(await exists(path))) throw new FactoryResetError(`Protected or required path is missing: ${path}`);
  }
  return { repositories: await repositoryHeads(), planSource: plan, databaseRunning };
}

async function inventory() {
  const preflight = await preflightApply({ requireDatabase: false });
  const tables = preflight.databaseRunning ? await planTableNames() : PLAN_PUBLIC_TABLES;
  const counts = preflight.databaseRunning
    ? await run('/usr/bin/docker', ['exec', 'itsaplan-postgres-1', 'psql', '-U', 'itsaplan', '-d', 'itsaplan', '-Atqc', "SELECT json_build_object('users',(SELECT count(*) FROM \"user\"),'teams',(SELECT count(*) FROM team),'projects',(SELECT count(*) FROM project),'agents',(SELECT count(*) FROM ai_agent),'issues',(SELECT count(*) FROM issue),'runs',(SELECT count(*) FROM agent_run),'apiKeys',(SELECT count(*) FROM apikey),'appSecrets',(SELECT count(*) FROM app_secret))"])
    : null;
  return {
    mode: 'dry-run', scriptVersion: SCRIPT_VERSION, changesApplied: false,
    destructiveConfirmation: CONFIRM_PHRASE,
    planCounts: counts ? JSON.parse(counts.stdout.trim()) : null,
    planDatabaseRunning: preflight.databaseRunning,
    resumeState: preflight.databaseRunning ? 'initial-or-running' : 'partial-stopped',
    planTableCount: tables.length,
    migrationSchemaPreserved: 'drizzle.__drizzle_migrations',
    firstUserSignup: { registrationDefault: 'open', firstRole: 'god', createsPersonalTeam: true },
    volumesToClear: DATA_VOLUMES,
    directoriesToClear: CLEAR_DIRECTORIES,
    pathsToRemove: REMOVE_PATHS,
    credentialsToRemove: SECRET_FILES.map((path) => path.replace(`${STACK_ROOT}/.secrets/`, '')),
    credentialsRegeneratedForBlankBoot: ['plan_control_token'],
    testComposeProjectRemoved: 'itsaplan-test',
    unitsToRemove: APP_UNITS,
    repositoriesPreserved: preflight.repositories,
    preservedInfrastructure: ['/etc/ssh', '/etc/cloudflared', 'cloudflared.service'],
    backupsPreserved: false,
  };
}

async function postconditions(repositoryBefore) {
  const tables = await planTableNames();
  const union = tables.map((table) => `SELECT ${sqlLiteral(table)} AS name, count(*)::bigint AS count FROM public.${sqlIdentifier(table)}`).join(' UNION ALL ');
  const counts = await run('/usr/bin/docker', ['exec', 'itsaplan-postgres-1', 'psql', '-U', 'itsaplan', '-d', 'itsaplan', '-Atqc', `SELECT count(*) FROM (${union}) q WHERE count <> 0`]);
  if (counts.stdout.trim() !== '0') throw new FactoryResetError('Plan contains residual rows');
  const migrations = await run('/usr/bin/docker', ['exec', 'itsaplan-postgres-1', 'psql', '-U', 'itsaplan', '-d', 'itsaplan', '-Atqc', 'SELECT count(*) FROM drizzle.__drizzle_migrations']);
  if (!/^\d+$/.test(migrations.stdout.trim()) || Number(migrations.stdout.trim()) < 1) throw new FactoryResetError('Plan migration history is missing');
  if (JSON.stringify(await repositoryHeads()) !== JSON.stringify(repositoryBefore)) throw new FactoryResetError('A protected repository HEAD changed');
  if (await exists(BACKUP_ROOT)) throw new FactoryResetError('Backup root still exists');
  for (const path of SECRET_FILES.filter((path) => !path.endsWith('/plan_control_token'))) {
    if (await exists(path)) throw new FactoryResetError(`Old credential remains: ${path}`);
  }
  const remainingSecrets = (await readdir(`${STACK_ROOT}/.secrets`, { withFileTypes: true }))
    .filter((entry) => entry.isFile() || entry.isSymbolicLink())
    .map((entry) => entry.name)
    .sort();
  assertExactSet(remainingSecrets, ['github_known_hosts', 'plan_control_token'], 'Post-reset service-secret allowlist');
  for (const path of REMOVE_PATHS) if (await exists(path)) throw new FactoryResetError(`Removed path remains: ${path}`);
  for (const unit of APP_UNITS.filter((entry) => !HERMES_BASELINE_UNITS.includes(entry))) {
    const state = await run('/usr/bin/systemctl', ['--user', 'is-active', unit], { allowFailure: true });
    if (state.stdout.trim() === 'active') throw new FactoryResetError('Application writer unit is still active: ' + unit);
    const enabled = await run('/usr/bin/systemctl', ['--user', 'is-enabled', unit], { allowFailure: true });
    if (/^enabled/.test(enabled.stdout.trim())) throw new FactoryResetError('Application writer unit is still enabled: ' + unit);
  }
  const hermesTimerState = await run('/usr/bin/systemctl', ['--user', 'is-active', 'volition-hermes-bootstrap.timer'], { allowFailure: true });
  const hermesTimerEnabled = await run('/usr/bin/systemctl', ['--user', 'is-enabled', 'volition-hermes-bootstrap.timer'], { allowFailure: true });
  if (hermesTimerState.stdout.trim() !== 'active' || hermesTimerEnabled.stdout.trim() !== 'enabled') {
    throw new FactoryResetError('Hermes first-run bootstrap timer is not active and enabled');
  }
  for (const volume of DATA_VOLUMES) {
    if ((await volumeEntryCount(volume)) !== 0) throw new FactoryResetError(`Reset volume is not empty: ${volume}`);
  }
  for (const path of CLEAR_DIRECTORIES.filter((entry) => !entry.endsWith('/garage/meta') && !entry.endsWith('/garage/data') && !entry.endsWith('/.state/vaultwarden') && !entry.endsWith('/data/hermes'))) {
    const entries = await readdir(path);
    if (entries.length !== 0) throw new FactoryResetError(`Reset directory is not empty: ${path}`);
  }
  const hermesFiles = await readdir(STACK_ROOT + '/data/hermes');
  assertExactSet(hermesFiles, ['config.yaml'], 'Hermes baseline files');
  const garageManifest = await run('/usr/bin/docker', ['exec', '-i', '-w', '/app/apps/api', 'itsaplan-api-1', 'bun', '-'], { input: await readFile(`${STACK_ROOT}/backup/tests/garage-manifest.mjs`, 'utf8') });
  const garage = JSON.parse(garageManifest.stdout);
  if (garage.count !== 0 || garage.totalBytes !== 0) throw new FactoryResetError('Garage contains objects');
  for (const name of ['itsaplan-worker-1', 'volition-apps-nextcloud-1', 'volition-apps-nextcloud-cron-1', 'volition-apps-nextcloud-db-1', 'volition-apps-nextcloud-redis-1', 'volition-apps-workspace-1']) {
    const state = await run('/usr/bin/docker', ['inspect', '--format', '{{.State.Running}}', name], { allowFailure: true });
    if (state.code === 0 && state.stdout.trim() === 'true') throw new FactoryResetError(`Application writer container is still running: ${name}`);
  }
  for (const name of ['itsaplan-postgres-1', 'itsaplan-garage-1', 'itsaplan-api-1', 'itsaplan-web-1', 'volition-vault-vaultwarden-1']) {
    const state = await run('/usr/bin/docker', ['inspect', '--format', '{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}', name]);
    if (!state.stdout.trim().startsWith('true|healthy')) throw new FactoryResetError(`Blank service is not healthy: ${name}`);
  }
  const testContainers = await run('/usr/bin/docker', ['ps', '-aq', '--filter', 'label=com.docker.compose.project=itsaplan-test']);
  if (testContainers.stdout.trim()) throw new FactoryResetError('itsaplan-test containers remain');
  const testVolumes = await run('/usr/bin/docker', ['volume', 'ls', '-q', '--filter', 'label=com.docker.compose.project=itsaplan-test']);
  if (testVolumes.stdout.trim()) throw new FactoryResetError('itsaplan-test volumes remain');
  const gateway = await run('/usr/bin/docker', ['inspect', '--format', '{{.State.Running}}', 'volition-stack-gateway-1'], { allowFailure: true });
  if (gateway.code !== 0 || gateway.stdout.trim() !== 'true') throw new FactoryResetError('Cloudflare owner gateway is not running');
  const gatewayConfig = await readFile(`${STACK_ROOT}/config/gateway.json`, 'utf8');
  const parsedGateway = JSON.parse(gatewayConfig);
  if (parsedGateway.ownerEmail !== 'patrick.wilhelm@volition.one') throw new FactoryResetError('Gateway owner changed');
  assertExactSet(Object.keys(parsedGateway.routes ?? {}), FACTORY_GATEWAY_ROUTES, 'Factory gateway routes');
  for (const unit of ['cloudflared.service', 'ssh.service']) {
    const state = await run('/usr/bin/systemctl', ['is-active', unit]);
    if (state.stdout.trim() !== 'active') throw new FactoryResetError(`Protected infrastructure is inactive: ${unit}`);
  }
  const planEnv = await readEnv(PLAN_ENV);
  const stackEnv = await readEnv(STACK_ENV);
  if (planEnv.values.get('VAULT_UI_ENABLED') !== 'true' || stackEnv.values.get('VAULT_UI_ENABLED') !== 'true') throw new FactoryResetError('Vault UI is not enabled');
  for (const key of [...PLAN_CLEARED_KEYS]) if ((planEnv.values.get(key) ?? '') !== '') throw new FactoryResetError(`Plan integration remains configured: ${key}`);
  for (const key of [...STACK_CLEARED_KEYS]) if ((stackEnv.values.get(key) ?? '') !== '') throw new FactoryResetError(`Stack integration remains configured: ${key}`);
  const vaultUsers = await run('/usr/bin/python3', ['-c', "import os,sqlite3; p='/home/pw/services/volition-stack/.state/vaultwarden/db.sqlite3'; print(0 if not os.path.exists(p) or os.path.getsize(p)==0 else sqlite3.connect(p).execute('select count(*) from users').fetchone()[0])"]);
  if (vaultUsers.stdout.trim() !== '0') throw new FactoryResetError('Vaultwarden contains an account');
  return { planRows: 0, migrationsPreserved: true, oldCredentialsAbsent: true, backupsAbsent: true, repositoriesPreserved: true };
}

export async function execute() {
  await preflightApply({ requireDatabase: false });
  await ensurePlanDatabaseForApply();
  const preflight = await preflightApply();
  const repositoryBefore = preflight.repositories;
  const planSource = preflight.planSource;
  await stopDisableUnits();
  await stopComposeStacks();
  await removeAppUnitFiles();
  await resetPlan(planSource);
  for (const volume of DATA_VOLUMES) await clearVolume(volume);
  await resetSecrets();
  await resetStackEnvironment();
  await resetGatewayConfig();
  await removePaths();
  await enableVaultFirstRunSignup();
  await startBlankServices();
  await installHermesUnderlay();
  const verified = await postconditions(repositoryBefore);
  return { mode: 'apply', scriptVersion: SCRIPT_VERSION, changed: true, verified };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = options.apply ? await execute() : await inventory();
  process.stdout.write(`${JSON.stringify(result, null, options.json ? 2 : 2)}\n`);
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`factory reset failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
