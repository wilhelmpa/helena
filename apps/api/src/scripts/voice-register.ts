// Registers the two voice servers native/local-ai/voice.sh set up (whisper.cpp for the ear,
// qwentts.cpp for the voice), once (idempotent), and reads their status and models. The owner
// can do the same in Administrator → Lokale KI → "Server hinzufügen". Lokale KI → Transkription
// and Vorlesen stay as they are until the owner points them at these servers.
//
//   sudo systemd-run --wait --pipe --collect --uid=volition-plan \
//     -p EnvironmentFile=/etc/volition/plan.env -p WorkingDirectory=/srv/volition/source/plan \
//     /usr/local/bin/bun apps/api/src/scripts/voice-register.ts
import { modelServerBySlug } from '@repo/db';
import { host } from '#shared/helena';
import { LOCAL_AI_PLUGIN_ID, LOCAL_AI_PROVIDES, localAiPlugin } from '#modules/local-ai/plugin';
import { createServer, refreshServer } from '#modules/local-ai/service';
import {
  QWEN_TTS,
  QWEN_TTS_DEFAULT_BASE_URL,
  WHISPER_CPP,
  WHISPER_CPP_DEFAULT_BASE_URL,
} from '#modules/local-ai/server-types';

await host.load(localAiPlugin, {
  id: LOCAL_AI_PLUGIN_ID,
  name: 'Local AI',
  version: '1.0.0',
  sdk: '^0.1.0',
  provides: LOCAL_AI_PROVIDES,
});

const SERVERS = [
  {
    slug: 'stt',
    kind: WHISPER_CPP,
    name: 'Spracherkennung (whisper.cpp, GPU)',
    baseUrl: WHISPER_CPP_DEFAULT_BASE_URL,
  },
  {
    slug: 'tts',
    kind: QWEN_TTS,
    name: 'Stimme (Qwen3-TTS, GPU)',
    baseUrl: QWEN_TTS_DEFAULT_BASE_URL,
  },
];

for (const entry of SERVERS) {
  const existing = await modelServerBySlug(entry.slug);
  const server = existing
    ? await refreshServer(existing.id)
    : await createServer({ ...entry, keySource: 'none' });
  console.log(
    `${existing ? 'checked' : 'registered'} ${server.name}: ${
      server.status?.reachable
        ? 'reachable'
        : `not reachable (${server.status?.error ?? 'unknown'})`
    }`,
  );
  for (const model of server.models)
    console.log(`  ${model.modelId}  ${model.capabilities.join(',')}  ${model.unit ?? '?'}`);
}
console.log(
  'Next: Administrator → Lokale KI → Transkription → helena-stt/whisper and Vorlesen → ' +
    'helena-tts/qwen3-tts (Lokal bevorzugt), and Sprache → Stimme.',
);
process.exit(0);
