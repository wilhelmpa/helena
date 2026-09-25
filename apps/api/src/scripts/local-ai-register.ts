// Registers the Lemonade server native/local-ai/install.sh set up, once (idempotent), and reads
// its status and models. The owner can do the same in Administrator → Server → Lokale KI;
// this is for the maintenance window. Local AI stays off until the owner turns it on.
//
//   sudo systemd-run --wait --pipe --collect --uid=volition-plan \
//     -p EnvironmentFile=/etc/volition/plan.env -p WorkingDirectory=/srv/volition/source/plan \
//     /usr/local/bin/bun apps/api/src/scripts/local-ai-register.ts
import { modelServerBySlug } from '@repo/db';
import { host } from '#shared/helena';
import { LOCAL_AI_PLUGIN_ID, LOCAL_AI_PROVIDES, localAiPlugin } from '#modules/local-ai/plugin';
import {
  DEFAULT_KEY_FILE,
  DEFAULT_SERVER_SLUG,
  createServer,
  refreshServer,
} from '#modules/local-ai/service';
import { LEMONADE, LEMONADE_DEFAULT_BASE_URL } from '#modules/local-ai/server-types';

await host.load(localAiPlugin, {
  id: LOCAL_AI_PLUGIN_ID,
  name: 'Local AI',
  version: '1.0.0',
  sdk: '^0.1.0',
  provides: LOCAL_AI_PROVIDES,
});

const existing = await modelServerBySlug(DEFAULT_SERVER_SLUG);
const server = existing
  ? await refreshServer(existing.id)
  : await createServer({
      slug: DEFAULT_SERVER_SLUG,
      kind: LEMONADE,
      name: 'Lokale KI (Lemonade)',
      baseUrl: LEMONADE_DEFAULT_BASE_URL,
      keySource: 'file',
      keyFile: DEFAULT_KEY_FILE,
    });

console.log(
  `${existing ? 'checked' : 'registered'} ${server.name}: ${
    server.status?.reachable
      ? `reachable, Lemonade ${server.status.version ?? '?'}`
      : `not reachable (${server.status?.error ?? 'unknown'})`
  }`,
);
for (const model of server.models) {
  console.log(
    `  ${model.modelId}  ${model.capabilities.join(',')}  ${model.unit ?? '?'}  ${model.downloaded === false ? 'not downloaded' : model.loaded ? 'loaded' : 'on disk'}`,
  );
}
process.exit(0);
