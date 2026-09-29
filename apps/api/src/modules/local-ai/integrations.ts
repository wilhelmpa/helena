import { listModelServers, readModelServerKey, type ModelServerRow } from '@repo/db';
import type {
  HostCapability,
  HostHealthItem,
  LocalizedText,
  UpdateCandidate,
  UpdateCheckContext,
  UpdateSource,
} from '@helena/sdk';
import { serverContext } from './service';
import { helperProgress } from '../updates/sources/cli-runtimes';
import { applyWhisperUpdate, whisperUpdateCandidate } from './whisper-update';

// Local AI in the extension points of other features (docs/helena-decisions/local-ai-platform.md
// §9), both registered by the `helena.local-ai` plugin: an update source for Administrator →
// Updates (`updateSources`) and a host capability for Administrator → Server
// (`hostCapabilities`, hub/server-admin): the model servers' health lines on the overview.

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

// ── Halogen ────────────────────────────────────────────────────────────────────────────

// native/halogen/install.sh pins the image by digest; its version is what Halogen's /health
// reports (the server's status). Newer versions are the image's tags on ghcr.io; the changelog
// is the repository's CHANGELOG.md. Check only: taking one is a new pin and a restart
// (the owner's click, in the maintenance window).
export const HALOGEN_IMAGE = 'peonist-ai/halogen-flash-server';
const HALOGEN_REPOSITORY = 'https://github.com/peonist-ai/halogen-flash-server';
const HALOGEN_CHANGELOG =
  'https://raw.githubusercontent.com/peonist-ai/halogen-flash-server/main/CHANGELOG.md';

// The newest release among an image's tags (`0.14.2`; not `latest`, not a prerelease).
export function newestReleaseTag(tags: string[]): string | null {
  let best: string | null = null;
  for (const tag of tags) {
    if (!/^v?\d+(\.\d+)*$/.test(tag)) continue;
    const plainTag = tag.replace(/^v/, '');
    if (!best || newer(plainTag, best)) best = plainTag;
  }
  return best;
}

// The changelog's sections of the versions after `installed` up to `available`
// (`## 0.14.2` headings), newest first.
export function changelogBetween(
  changelog: string,
  installed: string | null,
  available: string,
): string | null {
  const sections = changelog.split(/^(?=## )/m).filter((part) => part.startsWith('## '));
  const picked = sections.filter((section) => {
    const version = /^## \[?v?(\d+(?:\.\d+)*)/.exec(section)?.[1];
    if (!version) return false;
    return !newer(version, available) && (installed === null || newer(version, installed));
  });
  return picked.length > 0 ? picked.join('').trim().slice(0, 20_000) : null;
}

export async function halogenCandidate(
  server: ModelServerRow,
  context: UpdateCheckContext,
): Promise<UpdateCandidate> {
  const installed = plain(server.status?.version);
  try {
    const token = await context.fetchJson<{ token?: string }>(
      `https://ghcr.io/token?scope=repository:${HALOGEN_IMAGE}:pull`,
    );
    const list = await context.fetchJson<{ tags?: string[] }>(
      `https://ghcr.io/v2/${HALOGEN_IMAGE}/tags/list`,
      { headers: token.token ? { authorization: `Bearer ${token.token}` } : {} },
    );
    const available = newestReleaseTag(list.tags ?? []);
    return {
      component: 'halogen',
      name: 'Halogen (Qwen3.8-Flash-Next)',
      installed,
      available,
      updateAvailable: newer(available, installed),
      security: false,
      sourceUrl: HALOGEN_REPOSITORY,
      notesUrl: `${HALOGEN_REPOSITORY}/blob/main/CHANGELOG.md`,
      group: 'local-ai',
      applicable: false,
      hint: { i18n: 'localAi.updates.halogenHint' },
    };
  } catch (error) {
    return {
      component: 'halogen',
      name: 'Halogen (Qwen3.8-Flash-Next)',
      installed,
      available: null,
      updateAvailable: false,
      security: false,
      applicable: false,
      error: String(error).slice(0, 200),
    };
  }
}

// ── The update source ──────────────────────────────────────────────────────────────────

interface HfModel {
  id?: string;
  sha?: string;
  lastModified?: string;
  createdAt?: string;
}

// Model families that do not fit the machine yet but may soon (a smaller or distilled release):
// a repository newer than `since` whose name matches shows up as "neues Modell verfügbar",
// to be measured before anything changes. (docs/helena-decisions/local-ai-platform.md §5.1)
export const MODEL_WATCH: {
  id: string;
  name: string;
  author: string;
  search: string;
  match: RegExp;
  since: string;
  why: string;
}[] = [
  {
    id: 'qwen-flash-next',
    name: 'Qwen Flash-Next',
    author: 'Qwen',
    search: 'Flash-Next',
    match: /Flash-Next/i,
    since: '2026-08-27T00:00:00Z',
    why: 'Qwen3.8-Flash-Next (125B-A6B + n-gram table, ~180B, Qwen Community License) does not fit 96 GiB; a smaller or distilled release might',
  },
  {
    id: 'qwen4-moe',
    name: 'Qwen4 MoE',
    author: 'Qwen',
    search: 'Qwen4',
    match: /^Qwen\/Qwen4[.-].*A\d+B/i,
    since: '2026-09-01T00:00:00Z',
    why: 'a Qwen4 MoE with few active parameters (A3B–A10B) may replace the workhorse',
  },
];

// The newest repository of a watched family created after its baseline, or null.
export function newestWatched(
  entry: Pick<(typeof MODEL_WATCH)[number], 'match' | 'since'>,
  models: HfModel[],
): HfModel | null {
  const since = Date.parse(entry.since);
  return (
    models
      .filter((model) => model.id && entry.match.test(model.id))
      .filter((model) => Date.parse(model.createdAt ?? model.lastModified ?? '') > since)
      .sort((a, b) =>
        (b.createdAt ?? b.lastModified ?? '').localeCompare(a.createdAt ?? a.lastModified ?? ''),
      )[0] ?? null
  );
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

// Only the separately prepared Whisper package supports apply; models and other software remain check-only.
export const localAiUpdateSource: UpdateSource = {
  id: 'local-ai',
  label: { i18n: 'localAi.updates.label' },
  kind: 'tool',
  order: 60,
  apply: applyWhisperUpdate,
  progress: (ref) => helperProgress(ref),
  hosts: ['github.com', 'api.github.com', 'huggingface.co', 'ghcr.io', 'raw.githubusercontent.com'],
  async releaseNotes(candidate, context) {
    if (candidate.component !== 'halogen' || !candidate.available) return null;
    return changelogBetween(
      await context.fetchText(HALOGEN_CHANGELOG, { maxBytes: 256 * 1024 }),
      candidate.installed,
      candidate.available,
    );
  },
  async check(context: UpdateCheckContext): Promise<UpdateCandidate[]> {
    const servers = (await listModelServers()).filter((server) => server.enabled);
    const whisper = await whisperUpdateCandidate(context);
    const candidates: UpdateCandidate[] = whisper ? [whisper] : [];
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
    const inventory = await context.inventory();
    const voice = inventory?.voice as
      { qwentts?: { version?: string; present?: boolean } } | undefined;
    const tts = voice?.qwentts;
    if (tts && tts.present !== false) {
      const installed = typeof tts?.version === 'string' ? tts.version : null;
      let available: string | null = null;
      let error: string | null = null;
      try {
        const latest = await context.fetchJson<{ sha?: string }>(
          'https://api.github.com/repos/ServeurpersoCom/qwentts.cpp/commits/master',
        );
        available = /^[0-9a-f]{40}$/.test(latest.sha ?? '') ? latest.sha!.slice(0, 9) : null;
      } catch (failure) {
        error = failure instanceof Error ? failure.message : String(failure);
      }
      candidates.push({
        component: 'qwentts-cpp',
        name: 'qwentts.cpp (TTS)',
        installed,
        available,
        updateAvailable: Boolean(installed && available && !installed.startsWith(available)),
        security: false,
        sourceUrl: 'https://github.com/ServeurpersoCom/qwentts.cpp',
        applicable: false,
        hint: HINT,
        error,
      });
    }
    const embedding = inventory?.embedding as { version?: string; present?: boolean } | undefined;
    if (embedding && embedding.present !== false) {
      const installed = typeof embedding?.version === 'string' ? embedding.version : null;
      const available = await release('ggml-org/llama.cpp');
      candidates.push({
        component: 'llama-cpp-embedding',
        name: 'llama.cpp (Embedding)',
        installed,
        available,
        updateAvailable: Boolean(
          installed &&
          available &&
          /^b\d+$/.test(installed) &&
          /^b\d+$/.test(available) &&
          Number(available.slice(1)) > Number(installed.slice(1)),
        ),
        security: false,
        sourceUrl: 'https://github.com/ggml-org/llama.cpp',
        notesUrl: available
          ? `https://github.com/ggml-org/llama.cpp/releases/tag/${available}`
          : null,
        applicable: false,
        hint: HINT,
      });
    }
    if (servers.length === 0) return candidates;
    for (const server of servers.filter((entry) => entry.kind === 'halogen'))
      candidates.push(await halogenCandidate(server, context));
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
    for (const entry of MODEL_WATCH) {
      try {
        const models = await context.fetchJson<HfModel[]>(
          `https://huggingface.co/api/models?author=${encodeURIComponent(entry.author)}&search=${encodeURIComponent(entry.search)}&sort=createdAt&direction=-1&limit=20`,
        );
        const found = newestWatched(entry, Array.isArray(models) ? models : []);
        candidates.push({
          component: `watch:${entry.id}`,
          name: entry.name,
          installed: null,
          available: found?.id ?? null,
          updateAvailable: found !== null,
          security: false,
          sourceUrl: found?.id ? `https://huggingface.co/${found.id}` : null,
          group: 'local-ai-models',
          applicable: false,
          hint: HINT,
          detail: entry.why,
        });
      } catch (error) {
        context.log.warn(`watch ${entry.id}: ${String(error)}`);
      }
    }
    return candidates;
  },
};

// ── The host capability ────────────────────────────────────────────────────────────────

// On the Server overview (its web section shows the card with the units and models there). A
// server that does not answer is amber here: the agents fall back to their configured models.
// While local AI is on, Start's "Braucht dich" lists it in red (the local AI source, which
// links to where it is fixed), so the machine's own red list does not repeat it.
export const localAiHostCapability: HostCapability = {
  id: 'local-ai',
  label: { i18n: 'localAi.title' },
  area: 'overview',
  order: 50,
  async probe() {
    const servers = await listModelServers();
    return servers.length > 0
      ? { available: true }
      : { available: false, reason: 'not_installed', detail: 'No local model server' };
  },
  async health(): Promise<HostHealthItem[]> {
    return (await listModelServers())
      .filter((server) => server.enabled)
      .map((server) => ({
        id: `local-ai:${server.slug}`,
        state: !server.status ? 'unknown' : server.status.reachable ? 'ok' : 'attention',
        code: server.status?.reachable ? 'localAiServerUp' : 'localAiServerDown',
        values: { name: server.name },
        since: server.checkedAt ? server.checkedAt.toISOString() : null,
      }));
  },
};
