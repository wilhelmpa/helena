import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, open, readlink, rename, symlink } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { CollectedProfile } from './contributions';
import { ensureRoot, ensureSafeParent } from './files';
import {
  canonicalJson,
  maskValue,
  templateOf,
  type McpServerSpec,
  type ProfileDrift,
  type ProfileMcpServer,
  type RuntimeDefaults,
  type SessionFacts,
} from './runtime';

// Hermes as a runtime behind the adapter interface (runtime.ts): how Helena's MCP servers and
// settings are written into the agent's managed configuration, how the runner reads back what
// Hermes will really load, and what counts as drift.
//
// Every agent home links the one shared config.yaml of the deployment (provider, security,
// plugins). Everything that differs per agent is in the managed configuration Hermes merges
// over it (HERMES_MANAGED_DIR): the runner writes every MCP server there and turns off every
// server of the shared configuration Helena does not give the agent, so no entry of the
// shared file reaches an agent by accident. The probe below runs in Hermes' own Python and
// reads the result the way Hermes does: its own YAML reader, its own merge, its own defaults.

// One MCP server as Hermes' mcp_servers entry. `enabled` is always written, so a value in the
// shared configuration can never switch a server of Helena's off or on.
export function renderHermesMcp(spec: McpServerSpec): Record<string, unknown> {
  const values = (entries: McpServerSpec['env']) =>
    Object.fromEntries((entries ?? []).map(({ name, value }) => [name, templateOf(value)]));
  const passed = Object.fromEntries((spec.passEnv ?? []).map((name) => [name, `\${${name}}`]));
  const limits = {
    ...(spec.toolTimeoutSec !== undefined && { timeout: spec.toolTimeoutSec }),
    ...(spec.startupTimeoutSec !== undefined && { connect_timeout: spec.startupTimeoutSec }),
  };
  const entry =
    spec.transport === 'stdio'
      ? { command: spec.command, args: spec.args ?? [], env: { ...values(spec.env), ...passed } }
      : {
          url: spec.url,
          ...(spec.transport === 'sse' && { transport: 'sse' }),
          headers: values(spec.headers),
        };
  return { ...entry, ...limits, ...spec.hermes, enabled: true };
}

const DISABLED = { enabled: false };

// The managed mcp_servers: each of Helena's servers, and every other server Hermes would
// find (in the shared configuration, or from a plugin) turned off. A server the owner turned
// off for the agent, or that a contribution suppresses, is off too. Null when there is none.
export function hermesManagedMcp(
  collected: Pick<CollectedProfile, 'mcpServers' | 'suppressed'>,
  sharedServers: string[],
  denied: string[],
): Record<string, Record<string, unknown>> | null {
  const off = new Set([...denied, ...collected.suppressed]);
  const config: Record<string, Record<string, unknown>> = {};
  for (const spec of collected.mcpServers) {
    config[spec.name] = off.has(spec.name) ? DISABLED : renderHermesMcp(spec);
  }
  for (const name of [...sharedServers, ...collected.suppressed]) config[name] ??= DISABLED;
  return Object.keys(config).length > 0 ? config : null;
}

// The servers the agent's toolsets name: Helena's servers that are on.
export function enabledMcpServers(
  managed: Record<string, Record<string, unknown>> | null,
): string[] {
  return Object.entries(managed ?? {})
    .filter(([, entry]) => entry.enabled !== false)
    .map(([name]) => name);
}

// ── Reading back what Hermes loads ──────────────────────────────────────────────────────

export interface HermesProbe {
  // Where the home's config.yaml links to; null when it is not a link.
  configLink: string | null;
  configExists: boolean;
  // Whether Hermes read a managed configuration. It ignores one it cannot parse.
  managedLoaded: boolean;
  // The servers of the shared configuration and of plugins, before the managed one.
  sharedMcpServers: string[];
  // Every server after the merge, its env and header values masked (maskValue).
  mcpServers: Record<string, { enabled: boolean; entry: Record<string, unknown> | null }>;
  // The effective value of each managed setting the runner asked for.
  values: Record<string, unknown>;
  defaults: RuntimeDefaults;
  approvals: { singleQueryMode: string | null; plugins: string[] };
  security: { tirithEnabled: unknown; tirithFailOpen: unknown };
}

// Runs in Hermes' Python with HERMES_HOME and HERMES_MANAGED_DIR of the agent. It prints
// names, flags and masked values only: a value under env, headers or a key that sounds like a
// secret leaves as a short one-way digest (the runner masks its own values the same way).
export const HERMES_PROBE_SCRIPT = String.raw`
import copy, hashlib, json, os, re, sys
from pathlib import Path
request = json.load(sys.stdin)
home = Path(request["home"])
config_path = home / "config.yaml"
result = {"configLink": os.readlink(config_path) if os.path.islink(config_path) else None,
          "configExists": config_path.exists()}
from hermes_cli import managed_scope
from hermes_cli.config import _deep_merge, load_config_readonly, read_user_config_raw
SENSITIVE = re.compile(r"(token|secret|password|passwd|key|auth|credential|cookie|bearer)", re.I)
TEMPLATE = re.compile(r"\$\{[A-Z0-9_]+\}")
def mask(value):
    text = "" if value is None else str(value)
    if TEMPLATE.fullmatch(text):
        return text
    return "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]
def masked(node, secret=False):
    if isinstance(node, dict):
        return {str(k): masked(v, secret or str(k) in ("env", "headers") or bool(SENSITIVE.search(str(k))))
                for k, v in node.items()}
    if isinstance(node, list):
        return [masked(v, secret) for v in node]
    if secret and node is not None and not isinstance(node, bool):
        return mask(node)
    return node
def enabled(value):
    try:
        from hermes_cli.tools_config import _parse_enabled_flag
        return bool(_parse_enabled_flag(value, default=True))
    except Exception:
        if isinstance(value, str):
            return value.strip().lower() not in ("false", "no", "off", "0", "")
        return bool(value)
managed_scope.invalidate_managed_cache()
managed = managed_scope.load_managed_config() or {}
result["managedLoaded"] = bool(managed)
user = read_user_config_raw(config_path) if config_path.exists() else {}
shared = user.get("mcp_servers") if isinstance(user.get("mcp_servers"), dict) else {}
pinned = managed.get("mcp_servers") if isinstance(managed.get("mcp_servers"), dict) else {}
try:
    from hermes_cli.plugins import get_portable_mcp_server_names_nowait
    portable = {str(name) for name in get_portable_mcp_server_names_nowait()}
except Exception:
    portable = set()
result["sharedMcpServers"] = sorted({str(name) for name in shared} | portable)
servers = {}
for name in sorted({str(n) for n in shared} | {str(n) for n in pinned} | portable):
    base, over = shared.get(name), pinned.get(name)
    if isinstance(base, dict) and isinstance(over, dict):
        entry = _deep_merge(copy.deepcopy(base), copy.deepcopy(over))
    elif isinstance(over, dict):
        entry = copy.deepcopy(over)
    elif isinstance(base, dict):
        entry = copy.deepcopy(base)
    else:
        servers[name] = {"enabled": True, "entry": None}
        continue
    servers[name] = {"enabled": enabled(entry.get("enabled", True)), "entry": masked(entry)}
result["mcpServers"] = servers
effective = load_config_readonly()
def leaf(path):
    node = effective
    for part in path.split("."):
        if not isinstance(node, dict) or part not in node:
            return None
        node = node[part]
    if node is None or isinstance(node, (bool, int, float, str)):
        return node
    return json.loads(json.dumps(node, default=str))
result["values"] = {key: leaf(key) for key in request.get("keys", []) if not SENSITIVE.search(key)}
model = effective.get("model")
agent = effective.get("agent") if isinstance(effective.get("agent"), dict) else {}
result["defaults"] = {
    "model": ((model.get("default") or model.get("model")) if isinstance(model, dict) else model) or None,
    "provider": (model.get("provider") if isinstance(model, dict) else None) or None,
    "reasoning": agent.get("reasoning_effort") or None,
}
try:
    from tools.approval_context import _get_single_query_approval_mode
    mode = _get_single_query_approval_mode()
except Exception:
    mode = (effective.get("approvals") or {}).get("single_query_mode")
try:
    from hermes_cli.plugins_discovery import _get_disabled_plugins, _get_enabled_plugins
    plugins = sorted((_get_enabled_plugins() or set()) - _get_disabled_plugins())
except Exception:
    plugins = sorted((effective.get("plugins") or {}).get("enabled") or [])
security = effective.get("security") if isinstance(effective.get("security"), dict) else {}
result["approvals"] = {"singleQueryMode": mode, "plugins": plugins}
result["security"] = {"tirithEnabled": security.get("tirith_enabled"),
                      "tirithFailOpen": security.get("tirith_fail_open")}
json.dump(result, sys.stdout, default=str)
`;

// The model and reasoning of a session, from Hermes' own session store. Read-only.
export const HERMES_SESSION_SCRIPT = String.raw`
import json, sqlite3, sys
request = json.load(sys.stdin)
connection = sqlite3.connect("file:" + request["home"] + "/state.db?mode=ro", uri=True, timeout=5)
row = connection.execute(
    "SELECT model, model_config, billing_provider FROM sessions WHERE id = ?", (request["session"],)
).fetchone()
if row is None:
    json.dump(None, sys.stdout)
    sys.exit(0)
try:
    config = json.loads(row[1] or "{}")
except ValueError:
    config = {}
reasoning = config.get("reasoning_config") if isinstance(config, dict) else None
effort = None
if isinstance(reasoning, dict):
    effort = "none" if reasoning.get("enabled") is False else (reasoning.get("effort") or None)
model, provider = row[0] or None, row[2] or None
# sessions.model is the model the session started on: a resumed session that runs with
# another --model keeps it there. The latest model the session was billed for is the one
# that answered last; its start's reasoning then says nothing about it.
try:
    latest = connection.execute(
        "SELECT model, billing_provider FROM session_model_usage WHERE session_id = ?"
        " ORDER BY last_seen DESC LIMIT 1", (request["session"],)
    ).fetchone()
except sqlite3.Error:
    latest = None
if latest and latest[0]:
    if latest[0] != model:
        effort = None
    model, provider = latest[0], latest[1] or provider
json.dump({"model": model, "reasoning": effort, "provider": provider}, sys.stdout)
`;

// Hermes can hang on a lock like any process; a check must never hold up the claim loop.
const PYTHON_TIMEOUT_MS = 30_000;

export function runPython<T>(
  python: string,
  script: string,
  request: Record<string, unknown>,
  env: Record<string, string>,
  timeoutMs = PYTHON_TIMEOUT_MS,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = spawn(python, ['-c', script], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
    });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => (output += chunk));
    child.on('error', (error) => reject(new Error(`Hermes' Python: ${error.message}`)));
    child.stdin.on('error', () => {});
    child.on('close', (code, signal) => {
      if (signal) return reject(new Error(`Hermes' Python was stopped by ${signal}`));
      if (code !== 0) return reject(new Error(`Hermes' Python failed with ${code}`));
      try {
        resolve(JSON.parse(output) as T);
      } catch {
        reject(new Error("Hermes' Python answered something unreadable"));
      }
    });
    child.stdin.end(JSON.stringify(request));
  });
}

export function probeHermesProfile(
  home: string,
  managedDir: string,
  python: string,
  env: Record<string, string>,
  keys: string[],
): Promise<HermesProbe> {
  return runPython<HermesProbe>(
    python,
    HERMES_PROBE_SCRIPT,
    { home, keys },
    { ...env, HERMES_HOME: home, HERMES_MANAGED_DIR: managedDir },
  );
}

export function hermesSessionFacts(
  home: string,
  sessionId: string,
  python: string,
  env: Record<string, string>,
): Promise<SessionFacts | null> {
  return runPython<SessionFacts | null>(
    python,
    HERMES_SESSION_SCRIPT,
    { home, session: sessionId },
    env,
  );
}

// ── Drift ─────────────────────────────────────────────────────────────────────────────

// The dotted paths of the leaves of a configuration tree, with their values.
export function leaves(tree: Record<string, unknown>, prefix = ''): [string, unknown][] {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? leaves(value as Record<string, unknown>, path)
      : [[path, value] as [string, unknown]];
  });
}

// An entry as the probe prints it: every value under env, headers or a secret-sounding key
// reduced to maskValue().
const SENSITIVE = /(token|secret|password|passwd|key|auth|credential|cookie|bearer)/i;

export function maskEntry(node: unknown, secret = false): unknown {
  if (Array.isArray(node)) return node.map((item) => maskEntry(item, secret));
  if (node && typeof node === 'object') {
    return Object.fromEntries(
      Object.entries(node as Record<string, unknown>).map(([key, value]) => [
        key,
        maskEntry(value, secret || key === 'env' || key === 'headers' || SENSITIVE.test(key)),
      ]),
    );
  }
  if (secret && node !== null && node !== undefined && typeof node !== 'boolean') {
    return maskValue(String(node));
  }
  return node;
}

// The keys of two entries that differ, one level deep below env and headers.
function differingKeys(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const differ: string[] = [];
  for (const key of [...keys].sort()) {
    const left = a[key];
    const right = b[key];
    if (canonicalJson(left) === canonicalJson(right)) continue;
    if ((key === 'env' || key === 'headers') && isRecord(left) && isRecord(right)) {
      differ.push(...differingKeys(left, right).map((inner) => `${key}.${inner}`));
    } else differ.push(key);
  }
  return differ;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// The approval guard every home links (see the deployment's catalog script).
export const APPROVAL_GUARD_PLUGIN = 'plan-approval-guard';

export interface HermesExpectation {
  // What the runner wrote into the managed configuration.
  managedConfig: Record<string, unknown>;
  // The shared config.yaml the home has to link to, where the deployment names one.
  sharedConfig?: string;
}

// What the probe found that is not as Helena wrote it, and the MCP servers Hermes will
// start. The runner puts back what it can before it looks (files, links); what is left here
// is what it could not put right by itself.
export function hermesDrift(
  expected: HermesExpectation,
  probe: HermesProbe,
): { drift: ProfileDrift[]; mcpServers: ProfileMcpServer[] } {
  const drift: ProfileDrift[] = [];
  if (expected.sharedConfig && probe.configLink !== expected.sharedConfig) {
    drift.push({ key: 'config.yaml', code: 'not-linked' });
  }
  const { mcp_servers: managedMcp, ...settings } = expected.managedConfig as {
    mcp_servers?: Record<string, Record<string, unknown>>;
  } & Record<string, unknown>;
  const settingLeaves = leaves(settings);
  if (!probe.managedLoaded && (settingLeaves.length > 0 || managedMcp)) {
    drift.push({ key: 'run/itsaplan-managed/config.yaml', code: 'managed-config' });
  }
  for (const [path, value] of settingLeaves) {
    if (!(path in probe.values)) continue;
    if (canonicalJson(probe.values[path]) !== canonicalJson(value)) {
      drift.push({ key: path, code: 'setting-differs' });
    }
  }
  const mcpServers: ProfileMcpServer[] = [];
  const managed = managedMcp ?? {};
  const names = new Set([...Object.keys(managed), ...Object.keys(probe.mcpServers)]);
  for (const name of [...names].sort()) {
    const want = managed[name];
    const have = probe.mcpServers[name];
    const wantOn = want !== undefined && want.enabled !== false;
    mcpServers.push({ name, enabled: have?.enabled ?? false, managed: wantOn });
    const key = `mcp_servers.${name}`;
    if (!wantOn) {
      if (have?.enabled) drift.push({ key, code: 'mcp-unmanaged' });
      continue;
    }
    if (!have?.enabled) {
      drift.push({ key, code: 'mcp-missing' });
      continue;
    }
    // Whether it is on was compared above; a missing `enabled` means on to Hermes.
    const { enabled: _want, ...wanted } = maskEntry(want) as Record<string, unknown>;
    const { enabled: _have, ...found } = have.entry ?? {};
    const differ = have.entry ? differingKeys(wanted, found) : ['entry'];
    if (differ.length > 0) drift.push({ key, code: 'mcp-differs', detail: differ.join(', ') });
  }
  const { singleQueryMode, plugins } = probe.approvals;
  if (singleQueryMode === 'approve' && !plugins.includes(APPROVAL_GUARD_PLUGIN)) {
    drift.push({ key: 'approvals.single_query_mode', code: 'approval-guard' });
  }
  if (probe.security.tirithEnabled !== true || probe.security.tirithFailOpen !== false) {
    drift.push({ key: 'security.tirith', code: 'setting-differs' });
  }
  return { drift, mcpServers };
}

// ── The shared configuration link ───────────────────────────────────────────────────────

// Puts back the link from the home's config.yaml to the shared configuration: a file that
// took its place is moved to run/ next to the other copies of what was changed outside
// Helena, never read. True when it had to be put back.
export async function ensureConfigLink(home: string, shared: string): Promise<boolean> {
  return ensureSharedLink(home, 'config.yaml', shared);
}

// The same for any file the home shares with the global one (config.yaml, .env).
export async function ensureSharedLink(
  home: string,
  name: string,
  shared: string,
): Promise<boolean> {
  if (!isAbsolute(shared)) throw new Error('the runner config names an invalid shared config');
  await ensureRoot(home);
  const target = join(home, name);
  const info = await lstat(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (info?.isSymbolicLink() && (await readlink(target)) === shared) return false;
  if (info) {
    const aside = join(home, 'run', `${name}.outside-${Date.now()}`);
    await ensureSafeParent(home, aside);
    await rename(target, aside);
  }
  await symlink(shared, target);
  return true;
}

// Hermes keeps a profile's keys in its .env and `hermes doctor` fails a profile without
// one. Helena hands keys to Hermes itself (the runner's environment), so the file only has
// to exist: an empty one (0600) is created when missing; one that exists is never opened
// or changed. True when it had to be created.
export async function ensureEnvFile(home: string): Promise<boolean> {
  await ensureRoot(home);
  const target = join(home, '.env');
  try {
    const file = await open(
      target,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    await file.close();
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
}
