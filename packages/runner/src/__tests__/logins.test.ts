import { afterEach, describe, expect, it } from 'bun:test';
import { chmod, lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LoginUseReader,
  pythonVaultStore,
  WebLoginVault,
  type HermesVaultStore,
  type VaultItem,
  type WebLogin,
} from '../logins';
import {
  HermesPolicyMaterializer,
  HermesPolicySynchronizer,
  toolsetsWithBrowser,
  type RuntimePolicyClient,
  type RuntimePolicySnapshot,
} from '../policy';
import { fakeHermes } from './hermes-fake';

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function home(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'itsaplan-logins-'));
  roots.push(root);
  return join(root, 'hermes');
}

// Hermes' vault as a map of handles, with the calls the runner made.
function fakeStore() {
  const items = new Map<string, VaultItem>();
  const calls: { remove: string[]; items: VaultItem[] }[] = [];
  let next = 0;
  const store: HermesVaultStore = {
    async apply(change) {
      calls.push(change);
      for (const handle of change.remove) items.delete(handle);
      const handles: Record<string, string> = {};
      for (const item of change.items) {
        if (item.handle && items.has(item.handle)) {
          handles[item.key] = item.handle;
          continue;
        }
        if (item.origin === 'https://refused.example.com') continue;
        const handle = `vault_${++next}`;
        items.set(handle, { ...item, handle });
        handles[item.key] = handle;
      }
      return handles;
    },
  };
  return { store, items, calls };
}

const github: WebLogin = {
  id: 7,
  label: 'GitHub',
  updatedAt: '2026-09-23T10:00:00.000Z',
  origins: ['https://github.com', 'https://gist.github.com'],
  username: 'bot@example.com',
  password: 'fake-password',
  totpSecret: 'JBSWY3DPEHPK3PXP',
};

const shop: WebLogin = {
  id: 9,
  label: 'Shop admin',
  updatedAt: '2026-09-23T10:00:00.000Z',
  origins: ['https://shop.example.com'],
  username: 'ops',
  password: 'other-fake',
  totpSecret: null,
};

describe('web login vault', () => {
  it('writes one item per origin and a manifest without secrets', async () => {
    const hermesHome = await home();
    const { store, items } = fakeStore();
    const handles = await new WebLoginVault(hermesHome, store).sync([github, shop]);

    expect([...handles]).toEqual([
      ['vault_1', 7],
      ['vault_2', 7],
      ['vault_3', 9],
    ]);
    expect(items.get('vault_1')).toMatchObject({
      label: 'GitHub',
      origin: 'https://github.com',
      identifierType: 'email',
      identifier: 'bot@example.com',
      password: 'fake-password',
      otpSecret: 'JBSWY3DPEHPK3PXP',
    });
    expect(items.get('vault_3')).toMatchObject({ identifierType: 'username', otpSecret: null });

    const manifest = join(hermesHome, 'run/itsaplan-vault-manifest.json');
    expect((await lstat(manifest)).mode & 0o077).toBe(0);
    const content = await readFile(manifest, 'utf8');
    expect(content).not.toContain('fake-password');
    expect(content).not.toContain('JBSWY3DPEHPK3PXP');
  });

  it('keeps unchanged logins, replaces edited ones and removes revoked ones', async () => {
    const hermesHome = await home();
    const { store, items, calls } = fakeStore();
    const vault = new WebLoginVault(hermesHome, store);
    await vault.sync([github, shop]);

    const again = await vault.sync([github, shop]);
    expect(calls[1].remove).toEqual([]);
    expect(calls[1].items.map((item) => item.handle)).toEqual(['vault_1', 'vault_2', 'vault_3']);
    expect([...again.keys()]).toEqual(['vault_1', 'vault_2', 'vault_3']);

    const edited = { ...github, password: 'new-fake', updatedAt: '2026-09-23T11:00:00.000Z' };
    const afterEdit = await vault.sync([edited]);
    expect(calls[2].remove.sort()).toEqual(['vault_1', 'vault_2', 'vault_3']);
    expect([...afterEdit]).toEqual([
      ['vault_4', 7],
      ['vault_5', 7],
    ]);
    expect([...items.values()].map((item) => item.password)).toEqual(['new-fake', 'new-fake']);

    expect((await vault.sync([])).size).toBe(0);
    expect(items.size).toBe(0);
    // With nothing granted and nothing written, Hermes is not started at all.
    await vault.sync([]);
    expect(calls).toHaveLength(4);
  });

  it('writes a login again that was removed from the vault outside Plan', async () => {
    const hermesHome = await home();
    const { store, items } = fakeStore();
    const vault = new WebLoginVault(hermesHome, store);
    await vault.sync([shop]);
    items.clear();
    expect([...(await vault.sync([shop]))]).toEqual([['vault_2', 9]]);
  });

  it('keeps what the vault stored when it refuses a login, and says so', async () => {
    const hermesHome = await home();
    const { store, items } = fakeStore();
    const vault = new WebLoginVault(hermesHome, store);
    const refused = {
      ...shop,
      origins: ['https://shop.example.com', 'https://refused.example.com'],
    };
    await expect(vault.sync([refused])).rejects.toThrow('Hermes vault refused 1 login origin(s)');
    expect(items.size).toBe(1);
    // The next sync removes what the failed one added.
    await vault.sync([]);
    expect(items.size).toBe(0);
  });

  it("hands Hermes' Python the secrets on stdin, never in its arguments", async () => {
    const hermesHome = await home();
    const python = join(hermesHome, '..', 'python');
    const request = join(hermesHome, '..', 'request.json');
    await writeFile(
      python,
      [
        '#!/bin/sh',
        `printf '%s\\n' "$@" > '${request}.argv'`,
        `cat > '${request}'`,
        `printf '%s' "$HERMES_HOME" > '${request}.home'`,
        `echo '{"handles":{"9 https://shop.example.com":"vault_abc"}}'`,
      ].join('\n'),
    );
    await chmod(python, 0o755);
    const handles = await new WebLoginVault(
      hermesHome,
      pythonVaultStore(hermesHome, python, {}),
    ).sync([shop]);

    expect([...handles]).toEqual([['vault_abc', 9]]);
    expect(JSON.parse(await readFile(request, 'utf8'))).toMatchObject({
      home: hermesHome,
      remove: [],
      items: [{ key: '9 https://shop.example.com', password: 'other-fake' }],
    });
    expect(await readFile(`${request}.argv`, 'utf8')).not.toContain('other-fake');
    expect(await readFile(`${request}.home`, 'utf8')).toBe(hermesHome);
  });

  it('reports a failed Python run without its output', async () => {
    const hermesHome = await home();
    const python = join(hermesHome, '..', 'python');
    await writeFile(python, '#!/bin/sh\necho "VaultError: other-fake" >&2\nexit 3\n');
    await chmod(python, 0o755);
    const vault = new WebLoginVault(hermesHome, pythonVaultStore(hermesHome, python, {}));
    await expect(vault.sync([shop])).rejects.toThrow('Hermes vault update failed with 3');
  });

  it('survives a Python that exits before reading what it is sent', async () => {
    const hermesHome = await home();
    const vault = new WebLoginVault(hermesHome, pythonVaultStore(hermesHome, 'false', {}));
    const many = Array.from({ length: 400 }, (_, index) => ({
      ...shop,
      id: index,
      password: 'x'.repeat(1024),
    }));
    await expect(vault.sync(many)).rejects.toThrow('Hermes vault update failed with 1');
    await expect(
      new WebLoginVault(hermesHome, pythonVaultStore(hermesHome, '/nonexistent/python', {})).sync(
        many,
      ),
    ).rejects.toThrow(/^Hermes vault: .*ENOENT/);
  });

  it('stops a Python that does not finish in time', async () => {
    const hermesHome = await home();
    const python = join(hermesHome, '..', 'python');
    await writeFile(python, '#!/bin/sh\nexec sleep 30\n');
    await chmod(python, 0o755);
    const vault = new WebLoginVault(hermesHome, pythonVaultStore(hermesHome, python, {}, 200));
    await expect(vault.sync([shop])).rejects.toThrow('Hermes vault update was stopped by SIGKILL');
  });
});

describe('login use reader', () => {
  const line = (value: object) => `${JSON.stringify(value)}\n`;

  it('reads the successful fills of handles the runner wrote', () => {
    const reader = new LoginUseReader(new Map([['vault_1', 7]]));
    const output = [
      line({
        type: 'tool_use',
        name: 'browser_vault_fill',
        tool_call_id: 'a',
        input: { handle: 'vault_1' },
      }),
      line({
        type: 'tool_result',
        name: 'browser_vault_fill',
        tool_call_id: 'a',
        output: JSON.stringify({ success: true, origin: 'https://github.com', filled_fields: 1 }),
      }),
      line({
        type: 'tool_use',
        name: 'browser_vault_enter_code',
        tool_call_id: 'b',
        input: { handle: 'vault_1' },
      }),
      line({
        type: 'tool_result',
        name: 'browser_vault_enter_code',
        tool_call_id: 'b',
        output: JSON.stringify({ success: false, error: 'no_code_field' }),
      }),
      line({
        type: 'tool_use',
        name: 'browser_vault_fill',
        tool_call_id: 'c',
        input: { handle: 'vault_own' },
      }),
      line({
        type: 'tool_result',
        name: 'browser_vault_fill',
        tool_call_id: 'c',
        output: '{"success": true}',
      }),
      line({ type: 'text', text: 'done' }),
    ].join('');
    // The output arrives in pieces that split its lines.
    for (let at = 0; at < output.length; at += 17) reader.write(output.slice(at, at + 17));

    expect(reader.uses()).toEqual([
      { credentialId: 7, tool: 'browser_vault_fill', origin: 'https://github.com' },
    ]);
  });

  it('reads nothing when the runner wrote no logins', () => {
    const reader = new LoginUseReader(new Map());
    reader.write(
      line({ type: 'tool_use', name: 'browser_vault_fill', input: { handle: 'vault_1' } }),
    );
    expect(reader.uses()).toEqual([]);
  });
});

describe('run settings with website logins', () => {
  const profile = { toolsets: ['file', 'terminal'], mcpServers: ['itsaplan'] };
  // Helena's own MCP server is the runner's to write; Hermes is read back by a stand-in.
  const helena = { url: 'http://127.0.0.1:3000', reader: fakeHermes() };

  function client(snapshot: RuntimePolicySnapshot, logins: WebLogin[]) {
    const asked: unknown[] = [];
    const value: RuntimePolicyClient = {
      runtimePolicy: async () => snapshot,
      reportRuntimeStatus: async () => {},
      mcpSecrets: async () => ({}),
      webLogins: async (work) => {
        asked.push(work);
        return logins;
      },
    };
    return { value, asked };
  }

  const policy = (webLogins: boolean, toolDeny: string[] = []): RuntimePolicySnapshot => ({
    revision: `sha256:${webLogins}`,
    runtimePolicy: { files: [], toolDeny },
    skills: [],
    webLogins,
  });

  it('fills the vault for the run and turns the browser on', async () => {
    const hermesHome = await home();
    const { store, items } = fakeStore();
    const { value, asked } = client(policy(true, ['browser', 'terminal']), [shop]);
    const sync = new HermesPolicySynchronizer(
      value,
      new HermesPolicyMaterializer({ hermesHome, profile, context: helena }),
      {
        profile: { ...profile, toolsets: ['browser', ...profile.toolsets] },
        vault: new WebLoginVault(hermesHome, store),
      },
    );
    await sync.ensure();

    const settings = await sync.runSettings({ runId: 4 });
    expect(asked).toEqual([{ runId: 4 }]);
    expect(settings.toolsets).toEqual(['browser', 'file', 'itsaplan']);
    expect([...settings.logins!]).toEqual([['vault_1', 9]]);
    expect(items.size).toBe(1);
  });

  it('asks Plan for nothing without granted logins, and empties the vault', async () => {
    const hermesHome = await home();
    const { store, items } = fakeStore();
    const vault = new WebLoginVault(hermesHome, store);
    await vault.sync([shop]);
    const { value, asked } = client(policy(false), [shop]);
    const materializer = new HermesPolicyMaterializer({ hermesHome, profile, context: helena });
    const sync = new HermesPolicySynchronizer(value, materializer, { profile, vault });
    await sync.ensure();

    const settings = await sync.runSettings({ messageId: 5 });
    expect(asked).toEqual([]);
    expect(settings).toEqual({
      toolsets: ['file', 'terminal', 'itsaplan'],
      env: { HERMES_MANAGED_DIR: materializer.managedDir },
      logins: new Map(),
    });
    expect(items.size).toBe(0);
  });
});

describe('toolsets with the browser', () => {
  it('adds the browser to what the agent may use', () => {
    const profile = { toolsets: ['browser', 'file'], mcpServers: ['itsaplan'] };
    expect(toolsetsWithBrowser(profile, [])).toEqual(['browser', 'file', 'itsaplan']);
    expect(toolsetsWithBrowser(profile, ['browser', 'file'])).toEqual(['browser', 'itsaplan']);
    const without = { toolsets: ['file'], mcpServers: [] };
    expect(toolsetsWithBrowser(without, [], ['shop'])).toEqual(['file', 'shop', 'browser']);
    expect(toolsetsWithBrowser(undefined, ['browser'])).toBeNull();
  });
});
