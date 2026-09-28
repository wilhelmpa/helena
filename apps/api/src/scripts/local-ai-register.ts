// Registers the Lemonade server native/local-ai/install.sh set up (or, with --kind halogen, the
// Halogen server native/halogen/install.sh set up), once (idempotent), and reads its status and
// models. The owner can do the same in Administrator → Server → Lokale KI; this is for the
// maintenance window. Local AI stays off until the owner turns it on.
//
//   sudo systemd-run --wait --pipe --collect --uid=volition-plan \
//     -p EnvironmentFile=/etc/volition/plan.env -p WorkingDirectory=/srv/volition/source/plan \
//     /usr/local/bin/bun apps/api/src/scripts/local-ai-register.ts [--kind halogen | --embeddings]
//
// --embeddings: the server `local` (Lemonade until now) becomes the embedding server of
// native/local-ai/embed.sh (127.0.0.1:13308, same key, same model name), so the vectors in the
// index, which are named `helena-local/Qwen3-Embedding-0.6B-GGUF`, stay valid. Its other models
// leave the list; the classes that pointed at them fall back to their configured models.
import { modelServerBySlug } from '@repo/db';
import { host } from '#shared/helena';
import { LOCAL_AI_PLUGIN_ID, LOCAL_AI_PROVIDES, localAiPlugin } from '#modules/local-ai/plugin';
import {
  DEFAULT_KEY_FILE,
  DEFAULT_SERVER_SLUG,
  createServer,
  refreshServer,
  updateServer,
} from '#modules/local-ai/service';
import {
  HALOGEN,
  HALOGEN_DEFAULT_BASE_URL,
  LEMONADE,
  LEMONADE_DEFAULT_BASE_URL,
  OPENAI_COMPATIBLE,
} from '#modules/local-ai/server-types';

// native/local-ai/embed.sh.
const EMBEDDINGS_BASE_URL = 'http://127.0.0.1:13308/v1';

const kind = process.argv.includes('--kind')
  ? process.argv[process.argv.indexOf('--kind') + 1]
  : LEMONADE;
if (kind !== LEMONADE && kind !== HALOGEN) {
  console.error(`--kind ${kind}: only ${LEMONADE} or ${HALOGEN}`);
  process.exit(2);
}

await host.load(localAiPlugin, {
  id: LOCAL_AI_PLUGIN_ID,
  name: 'Local AI',
  version: '1.0.0',
  sdk: '^0.1.0',
  provides: LOCAL_AI_PROVIDES,
});

if (process.argv.includes('--embeddings')) {
  const current = await modelServerBySlug(DEFAULT_SERVER_SLUG);
  const input = {
    kind: OPENAI_COMPATIBLE,
    name: 'Embeddings (Qwen3-Embedding-0.6B)',
    baseUrl: EMBEDDINGS_BASE_URL,
    keySource: 'file' as const,
    keyFile: DEFAULT_KEY_FILE,
  };
  const server = current
    ? await updateServer(current.id, input)
    : await createServer({ slug: DEFAULT_SERVER_SLUG, ...input });
  console.log(
    `${current ? 'changed' : 'registered'} ${server.name}: ${server.status?.reachable ? 'reachable' : `not reachable (${server.status?.error ?? 'unknown'})`}`,
  );
  for (const model of server.models)
    console.log(`  ${model.modelId}  ${model.capabilities.join(',')}`);
  process.exit(0);
}

// Halogen has no key (loopback, the firewall lets only Helena's users in). Its KV pool (262,144
// positions) is shared by its conversation slots: agents are told half of it, so two long
// turns fit at once.
const slug = kind === HALOGEN ? 'halogen' : DEFAULT_SERVER_SLUG;
const existing = await modelServerBySlug(slug);
const server = existing
  ? await refreshServer(existing.id)
  : kind === HALOGEN
    ? await createServer({
        slug,
        kind: HALOGEN,
        name: 'Halogen (Qwen3.8-Flash-Next)',
        baseUrl: HALOGEN_DEFAULT_BASE_URL,
        keySource: 'none',
        contextLength: 131_072,
      })
    : await createServer({
        slug,
        kind: LEMONADE,
        name: 'Lokale KI (Lemonade)',
        baseUrl: LEMONADE_DEFAULT_BASE_URL,
        keySource: 'file',
        keyFile: DEFAULT_KEY_FILE,
      });

console.log(
  `${existing ? 'checked' : 'registered'} ${server.name}: ${
    server.status?.reachable
      ? `reachable, ${kind} ${server.status.version ?? '?'}`
      : `not reachable (${server.status?.error ?? 'unknown'})`
  }`,
);
for (const model of server.models) {
  console.log(
    `  ${model.modelId}  ${model.capabilities.join(',')}  ${model.unit ?? '?'}  ${model.downloaded === false ? 'not downloaded' : model.loaded ? 'loaded' : 'on disk'}`,
  );
}
process.exit(0);
