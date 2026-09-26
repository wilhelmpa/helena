import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, stat, chmod, symlink, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchLocalCodex } from './owner-local-codex.mjs';
import { LOCAL_API, LOCAL_MODELS, localCodexArguments, prepareLocalModel, readLocalState, removeLocalState } from './owner-local-model.mjs';

test('native bootstrap is kind/session bound, private, cached and removable without secrets in argv', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'local-terminal-state-'));
  const kind = 'local-qwen36';
  const token = 'synthetic-inference-capability';
  let calls = 0;
  const fake = async (url, init) => {
    calls++;
    assert.equal(url, `${LOCAL_API}/${kind}/bootstrap`);
    assert.equal(init.headers['x-owner-terminal-token'], 'synthetic-proof');
    assert.equal(init.redirect, 'error');
    assert.deepEqual(JSON.parse(init.body), { name: 'main' });
    return Response.json({ token, model: LOCAL_MODELS[kind], expiresAt: Math.floor(Date.now() / 1000) + 300 });
  };
  try {
    await prepareLocalModel(root, kind, 'main', 'synthetic-proof', 'session-a', fake);
    const state = await readLocalState(root, kind, 'main');
    assert.equal(state.token, token);
    assert.equal((await stat(path.join(root, `${kind}-main.json`))).mode & 0o777, 0o600);
    await prepareLocalModel(root, kind, 'main', 'synthetic-proof', 'session-a', fake);
    assert.equal(calls, 1);
    await prepareLocalModel(root, kind, 'main', 'synthetic-proof', 'session-b', fake);
    assert.equal(calls, 2);
    const args = localCodexArguments(kind).join(' ');
    assert.ok(args.includes('wire_api="responses"'));
    assert.ok(args.includes('request_max_retries=0'));
    assert.ok(!args.includes(token));
    assert.ok(!args.includes('--yolo'));
    await removeLocalState(root, kind, 'main');
    await assert.rejects(readLocalState(root, kind, 'main'));
    await prepareLocalModel(root, kind, 'main', 'synthetic-proof', 'session-c', fake);
    assert.equal((await readLocalState(root, kind, 'main')).sessionId, 'session-c');
    assert.equal(calls, 3);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('native state rejects unknown kinds, traversal, symlinks and accessible files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'local-terminal-invalid-'));
  try {
    assert.throws(() => localCodexArguments('shell'));
    await assert.rejects(readLocalState(root, 'local-qwen36', '../outside'));
    await symlink('/dev/null', path.join(root, 'local-qwen36-main.json'));
    await assert.rejects(readLocalState(root, 'local-qwen36', 'main'));
    await chmod(root, 0o755);
    await assert.rejects(readLocalState(root, 'local-qwen36', 'main'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

for (const kind of Object.keys(LOCAL_MODELS)) test(`${kind} launches managed Codex with per-tab state and environment-only capability`, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'local-terminal-launch-'));
  try {
    await prepareLocalModel(root, kind, 'main', 'synthetic-proof', 'session-a', async () => Response.json({ token: 'synthetic-capability', model: LOCAL_MODELS[kind], expiresAt: Date.now() / 1000 + 300 }));
    const launches = [];
    const spawnImpl = (...args) => { launches.push(args); return {}; };
    await launchLocalCodex(kind, 'main', { runtimeRoot: root, ownerHome: root, spawnImpl });
    const [binary, args, options] = launches[0];
    assert.equal(binary, '/usr/local/bin/codex');
    assert.ok(args.includes('--no-daemon'));
    assert.ok(!args.includes('resume'));
    assert.ok(args.join(' ').includes('wire_api="responses"'));
    assert.ok(!args.join(' ').includes('synthetic-capability'));
    assert.equal(options.env.HELENA_OWNER_LOCAL_TOKEN, 'synthetic-capability');
    assert.equal(options.env.CODEX_HOME, path.join(root, `.local/state/helena-owner-terminal/${kind}-main/codex`));
    await mkdir(path.join(options.env.CODEX_HOME, 'sessions/2026'), { recursive: true });
    await launchLocalCodex(kind, 'main', { runtimeRoot: root, ownerHome: root, spawnImpl });
    assert.deepEqual(launches[1][1].slice(-2), ['resume', '--last']);
    const shell = await readFile(new URL('./owner-terminal-shell', import.meta.url), 'utf8');
    assert.ok(shell.includes('local-qwen36 | local-qwen38)'));
    assert.ok(shell.includes('owner-local-codex.mjs'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('native deploy restarts the router from the checkout containing both helpers and preserves tmux', async () => {
  const unit = await readFile(new URL('./volition-owner-terminal.service', import.meta.url), 'utf8');
  const deploy = await readFile(new URL('../deploy.sh', import.meta.url), 'utf8');
  const setup = await readFile(new URL('./setup.sh', import.meta.url), 'utf8');
  assert.ok(unit.includes('WorkingDirectory=/srv/volition/source/plan/deployment/volition-stack/native/owner-terminal'));
  assert.ok(unit.includes('Environment=OWNER_TERMINAL_SHELL=/srv/volition/source/plan/deployment/volition-stack/native/owner-terminal/owner-terminal-shell'));
  assert.ok(deploy.includes('"$live/deployment/volition-stack/native/owner-terminal/setup.sh"\n  restart+=(volition-owner-terminal.service)'));
  assert.ok(!deploy.includes('restart+=(helena-owner-tmux.service)'));
  assert.ok(!setup.includes('restart helena-owner-tmux'));
  const nginx = await readFile(new URL('./nginx-owner-terminal.conf', import.meta.url), 'utf8');
  assert.ok(nginx.includes('location ~ ^/(backend/|api/)?owner-terminal/local/'));
  assert.ok(nginx.includes('local-qwen36|local-qwen38'));
});
