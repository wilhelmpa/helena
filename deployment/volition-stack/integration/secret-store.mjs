import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
export class SecretStoreValidationError extends Error {}

function metadata(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      name: typeof entry.name === "string" ? entry.name.slice(0, 128) : null,
      updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : null,
      allowedHosts: Array.isArray(entry.allowedHosts) ? entry.allowedHosts.filter((host) => typeof host === "string").slice(0, 20) : [],
    }))
    .filter((entry) => entry.name);
}

export function createSecretStore(config, options = {}) {
  const execute = options.secretCommand ?? execFileAsync;

  async function list() {
    const checkedAt = new Date().toISOString();
    if (!config.hermesBin) return { checkedAt, entries: [] };
    try {
      const result = await execute(config.hermesBin, ["vault", "list", "--json"], {
        shell: false,
        timeout: 20_000,
        maxBuffer: 512_000,
        encoding: "utf8",
      });
      const parsed = JSON.parse(result.stdout);
      return { checkedAt, entries: metadata(parsed?.entries ?? parsed) };
    } catch {
      return { checkedAt, entries: [] };
    }
  }

  async function set() {
    throw new SecretStoreValidationError("Vault metadata is read-only here; manage secrets in Vaultwarden");
  }

  return { list, set };
}
