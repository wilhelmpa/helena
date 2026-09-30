import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readFile, chmod, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AVA_KINDS, prepareAvaTools, readAvaState, forwardAvaMessage, avaCodexArguments, avaMcpConfig, handoff, removeAvaState } from './owner-ava-tools.mjs';

for (const kind of AVA_KINDS) test(`${kind} receives the same private Home MCP and canonical handoff`, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'volition-ava-tools-'));
  try {
    await prepareAvaTools(root, kind, 'main', 'synthetic-proof', 'session', async (url, init) => {
      assert.ok(url.endsWith(`/ava/${kind}/bootstrap`));
      assert.equal(init.headers['x-owner-terminal-token'], 'synthetic-proof');
      return Response.json({ token: 'synthetic-capability', expiresAt: Date.now() / 1000 + 60 });
    });
    assert.equal((await readAvaState(root, kind, 'main')).sessionId, 'session');
    const args = avaCodexArguments(kind, 'main', '/home/test').join(' ');
    assert.ok(args.includes('mcp_servers.volition='));
    assert.ok(args.includes('/home/test/volition/CLAUDE.md'));
    assert.ok(!args.includes('synthetic-capability'));
    assert.equal(avaMcpConfig(kind, 'main').mcpServers.volition.args.at(-2), kind);
    assert.ok(handoff('/home/test').includes('Home-Agent'));
    const replies = await forwardAvaMessage(root, kind, 'main', { id: 1, method: 'tools/list' }, async (url, init) => {
      assert.equal(url, 'http://127.0.0.1:3000/mcp');
      assert.equal(init.headers['x-volition-owner-tools'], 'synthetic-capability');
      return new Response('data: {"jsonrpc":"2.0","id":1,"result":{"tools":[]}}\n\n', { headers: { 'content-type': 'text/event-stream' } });
    });
    assert.equal(replies[0].id, 1);
    await assert.rejects(forwardAvaMessage(root, kind, 'main', {}, async () => new Response('', { status: 403 })));
    await removeAvaState(root, kind, 'main');
    await assert.rejects(readAvaState(root, kind, 'main'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('shared terminal capability rejects traversal and linked/public state', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'volition-ava-tools-invalid-'));
  try {
    assert.throws(() => avaMcpConfig('shell', 'main'));
    await assert.rejects(readAvaState(root, 'codex', '../outside'));
    await symlink('/dev/null', path.join(root, 'codex-main.json'));
    await assert.rejects(readAvaState(root, 'codex', 'main'));
    await chmod(root, 0o755);
    await assert.rejects(readAvaState(root, 'claude', 'main'));
    const shell = await readFile(new URL('./owner-terminal-shell', import.meta.url), 'utf8');
    assert.ok(shell.includes('owner-ava-tools.mjs'));
  } finally { await rm(root, { recursive: true, force: true }); }
});
