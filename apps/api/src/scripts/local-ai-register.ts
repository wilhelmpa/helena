// Registers the Lemonade server native/local-ai/install.sh set up (or, with --kind halogen, the
// Halogen server native/halogen/install.sh set up), once (idempotent), and reads its status and
// models. The owner can do the same in Administrator → Server → Lokale KI; this is for the
// maintenance window. Local AI stays off until the owner turns it on.
//
//   sudo systemd-run --wait --pipe --collect --uid=volition-plan \
//     -p EnvironmentFile=/etc/volition/plan.env -p WorkingDirectory=/srv/volition/source/plan \
//     /usr/local/bin/bun apps/api/src/scripts/local-ai-register.ts [--kind halogen]
import { modelServerBySlug } from '@repo/db';
import { host } from '#shared/helena';
import { LOCAL_AI_PLUGIN_ID, LOCAL_AI_PROVIDES, localAiPlugin } from '#modules/local-ai/plugin';
import {
  DEFAULT_KEY_FILE,
  DEFAULT_SERVER_SLUG,
  createServer,
  refreshServer,
} from '#modules/local-ai/service';
import {
  HALOGEN,
  HALOGEN_DEFAULT_BASE_URL,
  LEMONADE,
  LEMONADE_DEFAULT_BASE_URL,
} from '#modules/local-ai/server-types';

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
