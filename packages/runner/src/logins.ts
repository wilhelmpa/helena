import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

// The website logins Plan grants an agent reach Hermes' vault in the agent's profile
// (HERMES_HOME/vault): Hermes' browser_vault_fill and browser_vault_enter_code fill a login
// form from it without the model seeing the password or the authenticator key. Before each
// run and chat answer the runner makes the vault hold exactly the granted logins, one item
// per origin a login may be filled on, and leaves items it did not write alone.

export type WorkRef = { runId: number } | { messageId: number };

export interface WebLogin {
  id: number;
  label: string;
  // Changes whenever the login is edited in Plan.
  updatedAt: string;
  origins: string[];
  username: string;
  password: string;
  totpSecret: string | null;
}

export interface VaultItem {
  key: string;
  // The item written for this key before, kept while it is still in the vault.
  handle: string | null;
  label: string;
  origin: string;
  identifierType: 'email' | 'username';
  identifier: string;
  password: string;
  otpSecret: string | null;
}

// Removes the handles, then keeps every item whose handle is still in the vault and adds
// the others. Answers the handle of every item by its key; an item the vault refused has
// none.
export interface HermesVaultStore {
  apply(change: { remove: string[]; items: VaultItem[] }): Promise<Record<string, string>>;
}

interface ManifestEntry {
  key: string;
  credentialId: number;
  version: string;
  handle: string;
}

// Hermes' own VaultStore, run by its Python. The secrets reach it on stdin, never in
// argv or the environment.
const VAULT_SCRIPT = `
import json, sys
from pathlib import Path
from agent.vault_store import VaultStore
request = json.load(sys.stdin)
store = VaultStore(Path(request["home"]) / "vault")
for handle in request["remove"]:
    store.remove_item(handle)
existing = {item.id for item in store.list_items()}
handles = {}
for item in request["items"]:
    if item["handle"] in existing:
        handles[item["key"]] = item["handle"]
        continue
    secret = {"identifier_type": item["identifierType"], "identifier": item["identifier"], "password": item["password"]}
    if item["otpSecret"]:
        secret["otp_secret"] = item["otpSecret"]
    try:
        handles[item["key"]] = store.add_item(kind="login", label=item["label"], secret=secret, origin=item["origin"]).id
    except Exception:
        pass
json.dump({"handles": handles}, sys.stdout)
`;

export function pythonVaultStore(
  hermesHome: string,
  python: string,
  env: Record<string, string>,
): HermesVaultStore {
  return {
    apply: (change) =>
      new Promise((resolve, reject) => {
        const child = spawn(python, ['-c', VAULT_SCRIPT], {
          env: { ...process.env, ...env, HERMES_HOME: hermesHome },
          stdio: ['pipe', 'pipe', 'ignore'],
        });
        let output = '';
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => (output += chunk));
        child.on('error', (error) => reject(new Error(`Hermes vault: ${error.message}`)));
        // Hermes' errors can name a login, so only the exit code is passed on.
        child.on('close', (code) => {
          if (code !== 0) return reject(new Error(`Hermes vault update failed with ${code}`));
          try {
            resolve((JSON.parse(output) as { handles: Record<string, string> }).handles);
          } catch {
            reject(new Error('Hermes vault answered something unreadable'));
          }
        });
        child.stdin.end(JSON.stringify({ home: hermesHome, ...change }));
      }),
  };
}

// Hermes sorts a login's identifier into email, phone or username; Plan stores a username.
function identifierType(username: string): 'email' | 'username' {
  return /^[^\s@]+@[^\s@]+$/.test(username) ? 'email' : 'username';
}

async function writePrivate(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, content, { mode: 0o600, flag: 'wx' });
  await rename(temp, path);
}

// A home's vault and manifest are written by one sync at a time, whichever agent and feed
// it runs for.
const pending = new Map<string, Promise<unknown>>();

function serialized<T>(key: string, work: () => Promise<T>): Promise<T> {
  const next = (pending.get(key) ?? Promise.resolve()).catch(() => {}).then(work);
  pending.set(key, next);
  return next;
}

export class WebLoginVault {
  private readonly manifestPath: string;

  constructor(
    private readonly hermesHome: string,
    private readonly store: HermesVaultStore,
  ) {
    this.manifestPath = join(hermesHome, 'run', 'itsaplan-vault-manifest.json');
  }

  // Makes the vault hold exactly these logins. Answers the credential of every handle the
  // runner wrote, which is how a use Hermes reports is traced back to Plan.
  sync(logins: WebLogin[]): Promise<Map<string, number>> {
    return serialized(this.hermesHome, async () => {
      const previous = await this.readManifest();
      const desired = logins.flatMap((login) =>
        login.origins.map((origin) => ({ key: `${login.id} ${origin}`, origin, login })),
      );
      if (desired.length === 0 && previous.length === 0) return new Map();
      const known = new Map(previous.map((entry) => [entry.key, entry]));
      const current = (key: string, version: string) =>
        known.get(key)?.version === version ? known.get(key)!.handle : null;
      const keep = new Set(
        desired.filter((d) => current(d.key, d.login.updatedAt)).map((d) => d.key),
      );
      const handles = await this.store.apply({
        remove: previous.filter((entry) => !keep.has(entry.key)).map((entry) => entry.handle),
        items: desired.map(({ key, origin, login }) => ({
          key,
          handle: current(key, login.updatedAt),
          label: login.label,
          origin,
          identifierType: identifierType(login.username),
          identifier: login.username,
          password: login.password,
          otpSecret: login.totpSecret,
        })),
      });
      const entries = desired.flatMap(({ key, login }): ManifestEntry[] =>
        handles[key]
          ? [{ key, credentialId: login.id, version: login.updatedAt, handle: handles[key] }]
          : [],
      );
      // Written before a refusal is reported, so the next sync removes what this one added.
      await writePrivate(this.manifestPath, `${JSON.stringify({ schemaVersion: 1, entries })}\n`);
      if (entries.length < desired.length) {
        throw new Error(`Hermes vault refused ${desired.length - entries.length} login origin(s)`);
      }
      return new Map(entries.map((entry) => [entry.handle, entry.credentialId]));
    });
  }

  private async readManifest(): Promise<ManifestEntry[]> {
    try {
      const info = await lstat(this.manifestPath);
      if (info.isSymbolicLink() || !info.isFile() || (info.mode & 0o077) !== 0) {
        throw new Error('vault manifest is unsafe');
      }
      const value = JSON.parse(await readFile(this.manifestPath, 'utf8')) as {
        schemaVersion?: number;
        entries?: ManifestEntry[];
      };
      if (value.schemaVersion !== 1 || !Array.isArray(value.entries)) {
        throw new Error('vault manifest is invalid');
      }
      return value.entries;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }
}

export interface LoginUse {
  credentialId: number;
  tool: string;
  origin: string;
}

const VAULT_TOOLS = ['browser_vault_fill', 'browser_vault_enter_code'];

// Reads the logins Hermes filled from its stream-json output: a vault tool called with a
// handle the runner wrote, whose result says it succeeded.
export class LoginUseReader {
  private buffered = '';
  private readonly open = new Map<string, { tool: string; credentialId: number }>();
  private readonly found: LoginUse[] = [];

  constructor(private readonly handles: Map<string, number>) {}

  write(chunk: string): void {
    if (this.handles.size === 0) return;
    this.buffered += chunk;
    const lines = this.buffered.split('\n');
    this.buffered = lines.pop() ?? '';
    for (const line of lines) this.read(line);
  }

  uses(): LoginUse[] {
    if (this.buffered) this.read(this.buffered);
    this.buffered = '';
    return this.found;
  }

  private read(line: string): void {
    let event: {
      type?: string;
      name?: string;
      tool_call_id?: string;
      input?: { handle?: unknown };
      output?: string;
    };
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    if (!event || !VAULT_TOOLS.includes(event.name ?? '')) return;
    const key = event.tool_call_id ?? event.name!;
    if (event.type === 'tool_use') {
      const credentialId = this.handles.get(String(event.input?.handle ?? ''));
      if (credentialId !== undefined) this.open.set(key, { tool: event.name!, credentialId });
      return;
    }
    if (event.type !== 'tool_result') return;
    const call = this.open.get(key);
    this.open.delete(key);
    if (!call) return;
    try {
      const result = JSON.parse(event.output ?? '') as { success?: unknown; origin?: unknown };
      if (result.success !== true) return;
      this.found.push({
        credentialId: call.credentialId,
        tool: call.tool,
        origin: typeof result.origin === 'string' ? result.origin : '',
      });
    } catch {
      // A result Hermes cut short says nothing about whether the login was filled.
    }
  }
}
