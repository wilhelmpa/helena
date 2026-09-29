import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { app, apiKeyApi, authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { host } from '#shared/helena';
import { LOCAL_AI_PLUGIN_ID, LOCAL_AI_PROVIDES, localAiPlugin } from '#modules/local-ai/plugin';
import { db } from '@repo/db';
import { sql } from 'drizzle-orm';
import { resetVoiceQuotas } from '../../service';
import { wav } from '../fixtures';

// Voice end to end against a fake Lemonade (docs/helena-decisions/voice.md): the browser learns
// which way dictation and reading aloud go, a recording reaches the local transcription model
// with the key the browser never sees, the Lokale KI mode decides what is refused and how, and
// the limits hold.

const KEY = 'test-voice-key';
let fake: ReturnType<typeof Bun.serve>;
// What the fake received on its audio routes.
const received: {
  path: string;
  auth: string | null;
  model?: string;
  language?: string | null;
  fileType?: string;
  fileBytes?: number;
  json?: Record<string, unknown>;
}[] = [];
let transcriptBody: (() => ReadableStream<Uint8Array>) | null = null;
let healthy = true;
let transcript = 'Hallo Home, wie spät ist es?';

beforeAll(async () => {
  fake = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const auth = request.headers.get('authorization');
      if (auth !== `Bearer ${KEY}`) return new Response('no', { status: 401 });
      switch (url.pathname) {
        case '/api/v1/health':
          return healthy
            ? Response.json({ status: 'ok', version: '2026.39.1', all_models_loaded: [] })
            : new Response('down', { status: 503 });
        case '/api/v1/system-stats':
          return Response.json({});
        case '/api/v1/models':
          return Response.json({
            object: 'list',
            data: [
              {
                id: 'whisper-v3-turbo-FLM',
                recipe: 'flm',
                labels: ['transcription'],
                downloaded: true,
              },
              { id: 'kokoro-v1', recipe: 'kokoro', labels: ['tts'], downloaded: true },
            ],
          });
        case '/api/v1/audio/transcriptions': {
          const form = await request.formData();
          const file = form.get('file') as File;
          received.push({
            path: url.pathname,
            auth,
            model: String(form.get('model')),
            language: form.get('language') as string | null,
            fileType: file.type,
            fileBytes: file.size,
          });
          if (!healthy) return new Response('boom', { status: 500 });
          return transcriptBody
            ? new Response(transcriptBody(), { headers: { 'Content-Type': 'application/json' } })
            : Response.json({ text: transcript });
        }
        case '/api/v1/audio/speech': {
          const json = (await request.json()) as Record<string, unknown>;
          received.push({ path: url.pathname, auth, json });
          return new Response(wav(0.5), { headers: { 'content-type': 'audio/wav' } });
        }
        default:
          return new Response('not found', { status: 404 });
      }
    },
  });
  if (!host.modelServers.get('lemonade')) {
    await host.load(localAiPlugin, {
      id: LOCAL_AI_PLUGIN_ID,
      name: 'Local AI',
      version: '1.0.0',
      sdk: '^0.1.0',
      provides: LOCAL_AI_PROVIDES,
    });
  }
});

afterAll(() => fake.stop(true));

beforeEach(async () => {
  await resetDb();
  resetVoiceQuotas();
  received.length = 0;
  healthy = true;
  transcriptBody = null;
  transcript = 'Hallo Home, wie spät ist es?';
});

async function setup() {
  const owner = await signUpTestUser({ name: 'Owner' });
  const asOwner = authedApi(owner.cookie);
  const added = await asOwner.god['local-ai'].servers.post({
    kind: 'lemonade',
    baseUrl: `http://127.0.0.1:${fake.port}/api/v1`,
    keySource: 'stored',
    key: KEY,
  });
  expect(added.status).toBe(200);
  return { owner, asOwner, server: added.data! };
}

function upload(cookie: string, audio: Uint8Array, language?: string) {
  const form = new FormData();
  form.append('file', new Blob([audio], { type: 'audio/wav' }), 'recording.wav');
  if (language) form.append('language', language);
  return app.handle(
    new Request('http://localhost/voice/transcriptions', {
      method: 'POST',
      headers: { cookie },
      body: form,
    }),
  );
}

function speak(cookie: string, text: string) {
  return app.handle(
    new Request('http://localhost/voice/speech', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    }),
  );
}

describe('voice', () => {
  it('uses the browser while Lokale KI is off, and never calls the server', async () => {
    const { owner, asOwner } = await setup();
    const status = (await asOwner.voice.get()).data!;
    expect(status.transcription).toEqual({
      mode: 'off',
      local: false,
      reason: 'master-off',
      model: null,
    });
    expect(status.speech.local).toBe(false);
    expect(status.limits).toEqual({ maxSeconds: 120, maxBytes: 12582912, maxSpeechChars: 1000 });

    const refused = await upload(owner.cookie, wav(2));
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: 'voice-local-off' });
    // Master on, but the class stays off: still the browser's.
    await asOwner.god['local-ai'].policy.patch({ enabled: true, preset: 'eigene' });
    await asOwner.god['local-ai'].policy.patch({ classes: { transcription: { mode: 'off' } } });
    expect((await asOwner.voice.get()).data!.transcription).toMatchObject({
      mode: 'off',
      local: false,
      reason: 'class-off',
    });
    expect((await upload(owner.cookie, wav(2))).status).toBe(409);
    expect(received).toEqual([]);
  });

  it('transcribes on the local model with the key kept in the API', async () => {
    const { owner, asOwner } = await setup();
    expect((await asOwner.account.preferences.patch({ locale: 'de' })).status).toBe(200);
    await asOwner.god['local-ai'].policy.patch({ enabled: true });
    // Transcription is in the master switch's first set.
    const status = (await asOwner.voice.get()).data!;
    expect(status.transcription).toEqual({
      mode: 'prefer',
      local: true,
      reason: null,
      model: 'helena-local/whisper-v3-turbo-FLM',
    });
    // Reading aloud is not: the voice has to speak the owner's language.
    expect(status.speech).toMatchObject({ mode: 'off', local: false, reason: 'class-off' });

    // The saved locale determines the language even if the client sends another one.
    const answer = await upload(owner.cookie, wav(2.5), 'en');
    expect(answer.status).toBe(200);
    const fixtureResult = (await answer.json()) as { latencyMs: number };
    expect(fixtureResult).toMatchObject({
      text: 'Hallo Home, wie spät ist es?',
      model: 'helena-local/whisper-v3-turbo-FLM',
      durationMs: 2500,
    });
    expect(fixtureResult.latencyMs).toBeGreaterThanOrEqual(0);
    expect(received[0]?.fileType).toMatch(/^audio\/(x-)?wav$/);
    expect(received).toMatchObject([
      {
        path: '/api/v1/audio/transcriptions',
        auth: `Bearer ${KEY}`,
        model: 'whisper-v3-turbo-FLM',
        language: 'de',
        fileBytes: 44 + 80000,
      },
    ]);

    // Whisper's subtitle credit on silence comes back as nothing.
    transcript = 'Untertitel im Auftrag des ZDF für funk, 2017';
    expect(await (await upload(owner.cookie, wav(1))).json()).toMatchObject({ text: '' });
  });

  it('holds shared voice admission through the response body and refuses an exclusive update window', async () => {
    const { owner, asOwner } = await setup();
    await asOwner.god['local-ai'].policy.patch({ enabled: true });
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(748220, 13306)`);
      const refused = await upload(owner.cookie, wav(1));
      expect(refused.status).toBe(503);
      expect(await refused.json()).toMatchObject({ code: 'voice-maintenance' });
      expect(received).toEqual([]);
    });
    let close!: () => void;
    let opened!: () => void;
    const started = new Promise<void>((resolve) => {
      opened = resolve;
    });
    transcriptBody = () =>
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"text":'));
          close = () => {
            controller.enqueue(new TextEncoder().encode('"Hallo Home"}'));
            controller.close();
          };
          opened();
        },
      });
    const pending = upload(owner.cookie, wav(1));
    try {
      await started;
      await db.transaction(async (tx) => {
        const result = await tx.execute(
          sql`select pg_try_advisory_xact_lock(748220, 13306) as acquired`,
        );
        expect(result[0]?.acquired).toBe(false);
      });
    } finally {
      close();
    }
    expect((await pending).status).toBe(200);
    await db.transaction(async (tx) => {
      const result = await tx.execute(
        sql`select pg_try_advisory_xact_lock(748220, 13306) as acquired`,
      );
      expect(result[0]?.acquired).toBe(true);
    });
  });

  it('checks the recording before it goes anywhere', async () => {
    const { owner, asOwner } = await setup();
    await asOwner.god['local-ai'].policy.patch({ enabled: true });
    const notWav = await upload(owner.cookie, new TextEncoder().encode('x'.repeat(2000)));
    expect(notWav.status).toBe(400);
    expect(await notWav.json()).toMatchObject({ code: 'voice-bad-audio' });
    const short = await upload(owner.cookie, wav(0.1));
    expect(await short.json()).toMatchObject({ code: 'voice-too-short' });
    const long = await upload(owner.cookie, wav(121));
    expect(long.status).toBe(413);
    expect(await long.json()).toMatchObject({ code: 'voice-too-long' });
    const oversized = await upload(owner.cookie, new Uint8Array(12 * 1024 * 1024 + 1));
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toMatchObject({ code: 'voice-too-long' });
    const badLanguage = await upload(owner.cookie, wav(1), 'deu');
    expect(badLanguage.status).toBe(400);
    expect(received).toEqual([]);
  });

  it('says when local cannot take it, and when the model failed', async () => {
    const { owner, asOwner, server } = await setup();
    await asOwner.god['local-ai'].policy.patch({ enabled: true });
    await asOwner.god['local-ai'].policy.patch({ classes: { transcription: { mode: 'only' } } });

    // The model fails: 502, the browser says so.
    healthy = false;
    const failed = await upload(owner.cookie, wav(1));
    expect(failed.status).toBe(502);
    expect(await failed.json()).toMatchObject({ code: 'voice-local-failed' });

    // The server stops answering: "only" keeps it on the machine and says it is unavailable.
    await asOwner.god['local-ai'].servers({ id: server.id }).check.post();
    const status = (await asOwner.voice.get()).data!;
    expect(status.transcription).toEqual({
      mode: 'only',
      local: false,
      reason: 'server-down',
      model: null,
    });
    const down = await upload(owner.cookie, wav(1));
    expect(down.status).toBe(503);
    expect(await down.json()).toMatchObject({ code: 'voice-local-unavailable' });
  });

  it('reads a sentence aloud on the local voice once it is switched on', async () => {
    const { owner, asOwner } = await setup();
    await asOwner.god['local-ai'].policy.patch({ enabled: true });
    expect((await speak(owner.cookie, 'Hallo.')).status).toBe(409);
    const on = await asOwner.god['local-ai'].policy.patch({
      classes: { speech: { mode: 'prefer' } },
    });
    expect(on.status).toBe(200);
    expect((await asOwner.voice.get()).data!.speech).toMatchObject({
      local: true,
      model: 'helena-local/kokoro-v1',
    });
    const audio = await speak(owner.cookie, '  Guten   Morgen.  ');
    expect(audio.status).toBe(200);
    expect(audio.headers.get('content-type')).toBe('audio/wav');
    expect(audio.headers.get('x-helena-model')).toBe('helena-local/kokoro-v1');
    expect((await audio.arrayBuffer()).byteLength).toBe(44 + 16000);
    expect(received.at(-1)).toEqual({
      path: '/api/v1/audio/speech',
      auth: `Bearer ${KEY}`,
      json: { model: 'kokoro-v1', input: 'Guten Morgen.', response_format: 'wav' },
    });
    const tooLong = await speak(owner.cookie, 'a'.repeat(1001));
    expect(tooLong.status).toBe(413);
  });

  it('is for people: an agent key is refused', async () => {
    const { asOwner } = await setup();
    await asOwner.projects.post({ key: 'VOX', name: 'Voice' });
    const created = (
      await createAgent(asOwner, 'VOX', { name: 'Helper', username: 'helper', kind: 'external' })
    ).data!;
    const asAgent = apiKeyApi(created.apiKey!);
    expect((await asAgent.voice.get()).status).toBe(403);
  });
});
