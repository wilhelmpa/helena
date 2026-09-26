// Prepares a fresh dev stack for the voice E2E (scripts/voice-e2e.mjs): the owner (first
// sign-up), a project VOX with an external agent "Vera", the three fake model servers of
// scripts/voice-e2e-fakes.ts registered, local AI on with Transkription and Vorlesen on the
// fakes, and — with --reply — Helena's voice reply switched on after its eval passed. Writes the
// owner's cookie and the agent's key where the E2E and the fake runner read them.
//
//   bun scripts/voice-e2e-setup.ts --api http://localhost:25600 --app http://localhost:25601 \
//     --fakes http://127.0.0.1:25602 --out ~/agent-work/tmp/voice-e2e [--reply]
import { mkdirSync, writeFileSync } from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).reduce<string[][]>((pairs, value, index, all) => {
    if (value.startsWith('--'))
      pairs.push([
        value.slice(2),
        all[index + 1]?.startsWith('--') ? 'true' : (all[index + 1] ?? 'true'),
      ]);
    return pairs;
  }, []),
);
const API = args.api ?? 'http://localhost:25600';
const APP = args.app ?? 'http://localhost:25601';
const FAKES = args.fakes ?? 'http://127.0.0.1:25602';
const OUT = args.out ?? '.voice-e2e';
const KEY = 'voice-e2e-key';
mkdirSync(OUT, { recursive: true });

let cookie = '';
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(API + path, {
    method,
    headers: {
      origin: APP,
      ...(cookie && { cookie }),
      ...(body !== undefined && { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok)
    throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
  const setCookies = response.headers.getSetCookie();
  if (setCookies.length) cookie = setCookies.map((entry) => entry.split(';')[0]).join('; ');
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

await call('POST', '/api/auth/sign-up/email', {
  email: 'owner@voice-e2e.test',
  password: 'voice-e2e-password',
  name: 'Patrick Owner',
});
await call('POST', '/projects', { key: 'VOX', name: 'Voice' });
const projects = await call<{ id: number; key: string; teamId: number }[]>('GET', '/projects');
const project = projects.find((entry) => entry.key === 'VOX')!;
const created = await call<{ agent: { id: number }; apiKey: string }>(
  'POST',
  `/teams/${project.teamId}/ai-agents`,
  { name: 'Vera', username: 'vera', kind: 'external', projectIds: [project.id] },
);

for (const server of [
  { kind: 'whisper-cpp', slug: 'stt', baseUrl: `${FAKES}/w/v1`, keySource: 'none' },
  { kind: 'qwentts-cpp', slug: 'tts', baseUrl: `${FAKES}/q/v1`, keySource: 'none' },
  { kind: 'lemonade', slug: 'local', baseUrl: `${FAKES}/api/v1`, keySource: 'stored', key: KEY },
]) {
  await call('POST', '/god/local-ai/servers', server);
}
await call('PATCH', '/god/local-ai/policy', { enabled: true, preset: 'eigene' });
await call('PATCH', '/god/local-ai/policy', {
  classes: {
    transcription: { mode: 'prefer', model: 'helena-stt/whisper' },
    speech: { mode: 'prefer', model: 'helena-tts/qwen3-tts' },
  },
});
await call('PATCH', '/god/voice/settings', { voice: 'helena' });

if (args.reply) {
  const modelId = 'helena-local/Qwen3.6-35B-A3B-GGUF';
  const started = await call<{ id: number }>('POST', '/god/local-ai/evals', {
    classId: 'voice-reply',
    modelId,
  });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const evaluated = await call<{ status: string; passed: boolean; score: number }>(
      'GET',
      `/god/local-ai/evals/${started.id}`,
    );
    if (evaluated.status !== 'running') {
      console.log(`voice-reply eval: ${evaluated.status}, score ${evaluated.score}`);
      if (!evaluated.passed) throw new Error('the voice reply eval did not pass');
      break;
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  await call('PATCH', '/god/local-ai/policy', {
    classes: { 'voice-reply': { mode: 'prefer', model: modelId } },
  });
}

// The chat page opens the project's coordinator (created with the project): the fake runner
// answers as that agent, with a key of its own.
const agents = await call<{ id: number; name: string }[] | { items: { id: number; name: string }[] }>(
  'GET',
  `/teams/${project.teamId}/ai-agents`,
);
const list = Array.isArray(agents) ? agents : agents.items;
const coordinator = list.find((agent) => /coordinator/i.test(agent.name)) ?? created.agent;
const key =
  coordinator.id === created.agent.id
    ? created.apiKey
    : (
        await call<{ apiKey: string }>(
          'POST',
          `/teams/${project.teamId}/ai-agents/${coordinator.id}/regenerate-key`,
        )
      ).apiKey;
writeFileSync(`${OUT}/cookie`, cookie);
writeFileSync(`${OUT}/agent-key`, key);
console.log(
  JSON.stringify({
    project: 'VOX',
    agentId: created.agent.id,
    path: '/project/VOX/chat',
    reply: !!args.reply,
  }),
);
