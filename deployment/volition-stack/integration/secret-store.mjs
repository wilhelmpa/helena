import { spawn } from 'node:child_process';

export class SecretStoreValidationError extends Error {}
function nativeCommand(binary, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['pipe', 'pipe', 'pipe'], shell: false, env: process.env });
    let output = '', size = 0, settled = false;
    const timer = setTimeout(() => { child.kill('SIGKILL'); fail(); }, 20_000);
    function fail() { if (!settled) { settled = true; clearTimeout(timer); reject(new Error('Native secret store operation failed')); } }
    child.on('error', fail);
    child.stdout.on('data', chunk => { size += chunk.length; if (size > 512_000) { child.kill('SIGKILL'); fail(); } else output += chunk; });
    // Never include native stderr, argv output, or the submitted value in errors.
    child.stderr.resume();
    child.stdin.on('error', fail);
    child.on('close', code => { if (settled) return; if (code !== 0) return fail(); settled = true; clearTimeout(timer); resolve(output); });
    child.stdin.end(input === undefined ? undefined : input);
  });
}
function validated(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['name','value','allowedHosts'].includes(k))) throw new SecretStoreValidationError('Invalid secret request');
  if (!/^[A-Z][A-Z0-9_]{2,127}$/.test(input.name ?? '')) throw new SecretStoreValidationError('Use an uppercase secret name with letters, numbers and underscores');
  if (typeof input.value !== 'string' || !input.value.length || Buffer.byteLength(input.value) > 16_384 || input.value.includes('\0')) throw new SecretStoreValidationError('Secret value is empty or too long');
  if (!Array.isArray(input.allowedHosts) || input.allowedHosts.length > 20 || input.allowedHosts.some(h => typeof h !== 'string' || h.length > 253 || !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/.test(h))) throw new SecretStoreValidationError('Allowed hosts must be exact lowercase host names');
  return { name: input.name, value: input.value, allowedHosts: [...new Set(input.allowedHosts)] };
}
export function createSecretStore(config, options = {}) {
  const execute = options.secretCommand ?? nativeCommand;
  const binary = config.openClawBin || '/home/pw/.npm-global/bin/openclaw';
  async function list() {
    let raw;
    try { raw = JSON.parse(await execute(binary, ['secrets','store','list','--json'])); }
    catch { throw new Error('Native secret inventory is unavailable'); }
    if (!Array.isArray(raw)) throw new Error('Native secret inventory is invalid');
    return { checkedAt: new Date().toISOString(), entries: raw.filter(e => e.kind === 'secret' && e.scopeKind === 'team').map(e => ({ name: String(e.name), updatedAt: Number.isFinite(e.updatedAtMs) ? new Date(e.updatedAtMs).toISOString() : null, allowedHosts: Array.isArray(e.allowedHosts) ? e.allowedHosts.map(String) : [] })) };
  }
  async function set(input) {
    const value = validated(input);
    const args = ['secrets','store','set',value.name,'--kind','secret','--scope','team','--value-file','-', ...(value.allowedHosts.length ? value.allowedHosts.flatMap(h => ['--allow-host', h]) : ['--clear-allowed-hosts'])];
    await execute(binary, [...args,'--dry-run'], value.value);
    await execute(binary, args, value.value);
    const result = await list();
    if (!result.entries.some(e => e.name === value.name)) throw new Error('Secret metadata verification failed');
    return result;
  }
  return { list, set };
}
