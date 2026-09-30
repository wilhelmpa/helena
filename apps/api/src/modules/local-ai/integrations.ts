import {
  listModelServers,
  readLocalAiPolicy,
  readModelServerKey,
  type ModelServerRow,
} from '@repo/db';
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

export { familyOf, newerInFamily } from './model-watch';
import { checkWatchedModels } from './model-watch';
import { configuredModelWatch } from './model-watch-config';

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
    const configuredServers = await listModelServers();
    const servers = configuredServers.filter((server) => server.enabled);
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
        detail:
          'Für llama.cpp ist kein geprüftes b11277-Paket mit Umschaltung und Rollback vorbereitet. Der Vulkan-Dienst muss mit demselben Qwen3-Embedding-Modell auf Port 13308 laufen; vor der Freigabe sind Gesundheitsprüfung, Vektordimension, endliche Werte und ein semantischer Mini-Eval gegen den bisherigen Build nötig. Ein neuer Tag allein gibt den GPU-Build nicht frei.',
        hint: HINT,
      });
    }
    const policy = await readLocalAiPolicy();
    const watches = await configuredModelWatch(
      configuredServers,
      Object.values(policy.classes).flatMap((entry) => (entry.model ? [entry.model] : [])),
      inventory,
    );
    for (const server of configuredServers.filter((entry) => entry.kind === 'lemonade')) {
      for (const model of server.models.filter((entry) => entry.downloaded === true)) {
        const watch = watches.find((entry) => entry.repo === model.checkpoint?.split(':')[0]);
        if (watch) watch.revision = (await installedRevision(server, model.id)) ?? watch.revision;
      }
    }
    candidates.push(...(await checkWatchedModels(watches, context)));
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
      if (facts.flm)
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
