import { listModelServers, readModelServerKey, type ModelServerRow } from '@repo/db';
import type { Logger, LocalizedText } from '@helena/sdk';
import { serverContext } from './service';

// Local AI in two extension points of other branches (docs/helena-decisions/local-ai-platform.md
// §9): an update source for Administrator → Updates (hub/update-center, `updateSources`) and a
// host capability for Administrator → Server (hub/server-admin, `hostCapabilities`). Until both
// are merged, their contracts are mirrored here (same field names, same meaning); after the
// merge the objects are registered in modules/local-ai/plugin.ts and the mirrors go.

// ── mirror of @helena/sdk UpdateSource (hub/update-center, packages/sdk/src/updates.ts) ──

export interface LocalAiUpdateCandidate {
  component: string;
  name: string;
  installed: string | null;
  available: string | null;
  updateAvailable: boolean;
  security: boolean;
  sourceUrl?: string | null;
  notesUrl?: string | null;
  group?: string | null;
  applicable: boolean;
  hint?: LocalizedText | null;
  detail?: string | null;
  error?: string | null;
}

export interface LocalAiUpdateCheckContext {
  now: Date;
  log: Logger;
  manual: boolean;
  fetchText(url: string, options?: { maxBytes?: number }): Promise<string>;
  fetchJson<T = unknown>(url: string, options?: { maxBytes?: number }): Promise<T>;
}

// ── mirror of @helena/sdk HostCapability (hub/server-admin, packages/sdk/src/host.ts) ────

export type LocalAiHealthState = 'ok' | 'attention' | 'critical' | 'unknown';

export interface LocalAiHealthItem {
  id: string;
  state: LocalAiHealthState;
  code?: string;
  values?: Record<string, string | number>;
  since?: string | null;
}

// ── Versions ───────────────────────────────────────────────────────────────────────────

// The release tags of a GitHub repository's Atom feed (web content, not the REST API, so no
// hourly limit), newest first, without release candidates.
export function atomTags(feed: string): string[] {
  const tags: string[] = [];
  for (const match of feed.matchAll(/<link[^>]+href="[^"]*\/releases\/tag\/([^"]+)"/g)) {
    const tag = decodeURIComponent(match[1]!);
    if (/candidate|rc|alpha|beta|nightly/i.test(tag)) continue;
    if (!tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

const plain = (tag: string | undefined | null) => (tag ? tag.replace(/^v/, '') : null);

function newer(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const pa = a.split(/[.-]/).map(Number);
  const pb = b.split(/[.-]/).map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (Number.isNaN(x) || Number.isNaN(y)) return a !== b;
    if (x !== y) return x > y;
  }
  return false;
}

// A model family name split around its version: `Qwen3.6-35B-A3B-GGUF` is `Qwen` 3.6
// `-35B-A3B-GGUF`. Null for a name without one.
export function familyOf(repoName: string): { head: string; version: string; tail: string } | null {
  const match = /^([A-Za-z][A-Za-z-]*?)-?(\d+(?:\.\d+)?)(-.+)?$/.exec(repoName);
  if (!match) return null;
  return { head: match[1]!, version: match[2]!, tail: match[3] ?? '' };
}

// A newer release of the same family by the same publisher (Qwen3.6-35B-A3B → Qwen3.7-35B-A3B),
// from the Hugging Face model list.
export function newerInFamily(repo: string, candidates: string[]): string | null {
  const [author, name] = repo.split('/');
  if (!author || !name) return null;
  const family = familyOf(name);
  if (!family) return null;
  let best: { id: string; version: string } | null = null;
  for (const id of candidates) {
    const [otherAuthor, otherName] = id.split('/');
    if (otherAuthor !== author || !otherName) continue;
    const other = familyOf(otherName);
    if (!other || other.head !== family.head || other.tail !== family.tail) continue;
    if (!newer(other.version, family.version)) continue;
    if (!best || newer(other.version, best.version)) best = { id, version: other.version };
  }
  return best?.id ?? null;
}

// ── The update source ──────────────────────────────────────────────────────────────────

interface HfModel {
  id?: string;
  sha?: string;
  lastModified?: string;
}

async function serverFacts(server: ModelServerRow) {
  const key = await readModelServerKey(server);
  const context = serverContext(server, key, 5_000);
  try {
    const info = (await (await context.fetch('/system-info')).json()) as Record<string, unknown>;
    const recipes = (info.recipes ?? {}) as Record<
      string,
      { backends?: Record<string, { version?: string }> }
    >;
    const version = (recipe: string) =>
      Object.values(recipes[recipe]?.backends ?? {}).find((backend) => backend.version)?.version ??
      null;
    return { flm: version('flm'), llamacpp: version('llamacpp') };
  } catch {
    return { flm: null, llamacpp: null };
  }
}

// The installed revision of a model: the snapshot commit in the path of its first file
// (Lemonade's `GET /models/{id}/files?include_paths=true`).
async function installedRevision(server: ModelServerRow, model: string): Promise<string | null> {
  const key = await readModelServerKey(server);
  try {
    const response = await serverContext(server, key, 5_000).fetch(
      `/models/${encodeURIComponent(model)}/files?include_paths=true`,
    );
    const body = (await response.json()) as { files?: { path?: string }[] } | { path?: string }[];
    const files = Array.isArray(body) ? body : (body.files ?? []);
    for (const file of files) {
      const match = /\/snapshots\/([0-9a-f]{40})\//.exec(file.path ?? '');
      if (match) return match[1]!;
    }
  } catch {
    // Unknown: the check still reports the newest revision.
  }
  return null;
}

const HINT: LocalizedText = { i18n: 'localAi.updates.hint' };

export const localAiUpdateSource = {
  id: 'local-ai',
  label: { i18n: 'localAi.updates.label' } as LocalizedText,
  kind: 'tool' as const,
  order: 60,
  hosts: ['github.com', 'huggingface.co'],
  async check(context: LocalAiUpdateCheckContext): Promise<LocalAiUpdateCandidate[]> {
    const servers = (await listModelServers()).filter((server) => server.enabled);
    if (servers.length === 0) return [];
    const candidates: LocalAiUpdateCandidate[] = [];
    const release = async (repository: string) => {
      try {
        return plain(
          atomTags(await context.fetchText(`https://github.com/${repository}/releases.atom`))[0],
        );
      } catch (error) {
        context.log.warn(`releases of ${repository}: ${String(error)}`);
        return null;
      }
    };
    const lemonade = servers.find((server) => server.kind === 'lemonade');
    if (lemonade) {
      const installed = plain(lemonade.status?.version);
      const available = await release('lemonade-sdk/lemonade');
      candidates.push({
        component: 'lemonade',
        name: 'Lemonade Server',
        installed,
        available,
        updateAvailable: newer(available, installed),
        security: false,
        sourceUrl: 'https://github.com/lemonade-sdk/lemonade',
        notesUrl: available
          ? `https://github.com/lemonade-sdk/lemonade/releases/tag/v${available}`
          : null,
        group: 'local-ai',
        applicable: false,
        hint: HINT,
      });
      const facts = await serverFacts(lemonade);
      const flm = await release('ROCm/FastFlowLM');
      candidates.push({
        component: 'fastflowlm',
        name: 'FastFlowLM (NPU)',
        installed: plain(facts.flm),
        available: flm,
        updateAvailable: newer(flm, plain(facts.flm)),
        security: false,
        sourceUrl: 'https://github.com/ROCm/FastFlowLM',
        group: 'local-ai',
        applicable: false,
        hint: HINT,
      });
    }
    for (const server of servers) {
      for (const model of server.models) {
        const repo = model.checkpoint?.split(':')[0];
        if (!repo || model.downloaded === false) continue;
        try {
          const info = await context.fetchJson<HfModel>(
            `https://huggingface.co/api/models/${repo}`,
          );
          const installed = await installedRevision(server, model.id);
          const author = repo.split('/')[0]!;
          const head = familyOf(repo.split('/')[1] ?? '')?.head;
          const list = head
            ? await context.fetchJson<HfModel[]>(
                `https://huggingface.co/api/models?author=${encodeURIComponent(author)}&search=${encodeURIComponent(head)}&sort=lastModified&direction=-1&limit=50`,
              )
            : [];
          const family = newerInFamily(
            repo,
            list.map((entry) => entry.id ?? ''),
          );
          const revision = info.sha ?? null;
          candidates.push({
            component: `model:${model.id}`,
            name: model.name,
            installed: installed ? installed.slice(0, 12) : null,
            available: revision ? revision.slice(0, 12) : null,
            updateAvailable: Boolean(installed && revision && installed !== revision),
            security: false,
            sourceUrl: `https://huggingface.co/${repo}`,
            group: 'local-ai-models',
            applicable: false,
            hint: HINT,
            detail: family ? `newer family model: ${family}` : null,
          });
        } catch (error) {
          candidates.push({
            component: `model:${model.id}`,
            name: model.name,
            installed: null,
            available: null,
            updateAvailable: false,
            security: false,
            applicable: false,
            error: String(error).slice(0, 200),
          });
        }
      }
    }
    return candidates;
  },
};

// ── The host capability ────────────────────────────────────────────────────────────────

export const localAiHostCapability = {
  id: 'local-ai',
  label: { i18n: 'localAi.title' } as LocalizedText,
  // Its own tab in Administrator → Server (an `admin-section` slot of the same id).
  area: 'local-ai',
  order: 10,
  async probe() {
    const servers = await listModelServers();
    return servers.length > 0
      ? { available: true }
      : { available: false, reason: 'not_installed' as const, detail: 'No local model server' };
  },
  async health(): Promise<LocalAiHealthItem[]> {
    return (await listModelServers())
      .filter((server) => server.enabled)
      .map((server) => ({
        id: `local-ai:${server.slug}`,
        state: !server.status
          ? ('unknown' as const)
          : server.status.reachable
            ? ('ok' as const)
            : ('attention' as const),
        code: server.status?.reachable ? 'local-ai.server-up' : 'local-ai.server-down',
        values: { name: server.name },
        since: server.checkedAt ? server.checkedAt.toISOString() : null,
      }));
  },
};
