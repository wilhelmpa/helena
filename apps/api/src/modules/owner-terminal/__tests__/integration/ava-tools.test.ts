import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app, authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { bootstrapHomeAgent } from '../../../../scripts/bootstrap-home-agent';
import { setOwnerTerminalSettings } from '../../service';
import { OWNER_TOOLS_HEADER } from '../../ava-tools';
import { useHostdTransport } from '#modules/server/hostd';

const keyFile = join(mkdtempSync(join(tmpdir(), 'volition-ava-terminal-')), 'key');
writeFileSync(keyFile, 'synthetic-terminal-signing-key');
process.env.OWNER_TERMINAL_KEY_PATH = keyFile;
beforeEach(async () => {
  await resetDb();
  useHostdTransport(async (method) =>
    method === 'RunPrivileged'
      ? { exitCode: 0, output: '0\n', unit: 'synthetic.service' }
      : { enabled: true, unrestricted: true, directOnly: true, epoch: 1 },
  );
});
afterEach(() => useHostdTransport(null));

async function setup() {
  const owner = await signUpTestUser();
  await authedApi(owner.cookie).projects.post({ key: 'DEV', name: 'Development' });
  await bootstrapHomeAgent();
  await setOwnerTerminalSettings({ stepUpRequired: false });
  return owner;
}
async function bootstrap(cookie: string, kind: string) {
  const proof = await app.handle(
    new Request(`http://localhost/auth/verify/owner-terminal/${kind}`, {
      headers: { cookie, 'x-real-ip': '192.168.1.2' },
    }),
  );
  expect(proof.status).toBe(204);
  const response = await app.handle(
    new Request(`http://localhost/owner-terminal/ava/${kind}/bootstrap`, {
      method: 'POST',
      headers: { 'x-owner-terminal-token': proof.headers.get('x-owner-terminal-token')! },
    }),
  );
  expect(response.status).toBe(200);
  return ((await response.json()) as { token: string }).token;
}
async function call(
  token: string,
  name: string,
  args: object = {},
  headers: Record<string, string> = {},
) {
  const response = await app.handle(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        [OWNER_TOOLS_HEADER]: token,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...headers,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: name === 'list' ? 'tools/list' : 'tools/call',
        params: name === 'list' ? {} : { name, arguments: args },
      }),
    }),
  );
  if (response.status !== 200) return { status: response.status, result: null };
  const raw = await response.text();
  return {
    status: 200,
    result: JSON.parse(
      raw.startsWith('event:') || raw.startsWith('data:')
        ? raw
            .split('\n')
            .find((line) => line.startsWith('data: '))!
            .slice(6)
        : raw,
    ).result,
  };
}

describe('Ava tools in owner terminals', () => {
  it('exposes Home development and root tools on every terminal runtime', async () => {
    const owner = await setup();
    for (const kind of [
      'claude',
      'codex',
      'local-flash',
      'local-qwen38',
      'helena-dev-claude',
      'helena-dev-codex',
    ]) {
      const token = await bootstrap(owner.cookie, kind);
      const listed = await call(token, 'list');
      expect(listed.status).toBe(200);
      expect(listed.result.tools.map((tool: { name: string }) => tool.name)).toEqual(
        expect.arrayContaining(['run_as_root', 'enqueue_codex_task', 'run_development_operation']),
      );
      const root = await call(token, 'run_as_root', {
        command: 'id -u',
        reason: 'Synthetic terminal test',
      });
      expect(root.result.isError).not.toBe(true);
      expect(root.result.structuredContent.data.status).toBe('success');
    }
    const audit = await authedApi(owner.cookie, { origin: 'http://localhost:3001' }).god[
      'root-access'
    ].audit.get();
    expect(audit.data).toEqual(
      expect.arrayContaining(
        ['claude', 'codex', 'helena'].map((runtime) =>
          expect.objectContaining({ runtime, status: 'success' }),
        ),
      ),
    );
  });
  it('rejects forged/native-boundary credentials and immediately enforces grant changes', async () => {
    const owner = await setup();
    const token = await bootstrap(owner.cookie, 'codex');
    expect((await call('forged', 'list')).status).toBe(403);
    const refusedHeaders: Record<string, string>[] = [
      { origin: 'http://localhost' },
      { cookie: owner.cookie },
      { 'x-forwarded-for': '192.168.1.2' },
      { 'x-api-key': 'synthetic' },
      { 'x-volition-agent-project': 'home' },
    ];
    for (const headers of refusedHeaders)
      expect((await call(token, 'list', {}, headers)).status).toBe(403);
    await setOwnerTerminalSettings({ stepUpRequired: true });
    expect((await call(token, 'list')).status).toBe(403);
  });
});
