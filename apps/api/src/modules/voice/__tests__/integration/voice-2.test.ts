import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { apiKeyApi, app, authedApi, type Api } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createAgent } from '#tests/helpers/agents';
import { host } from '#shared/helena';
import { LOCAL_AI_PLUGIN_ID, LOCAL_AI_PROVIDES, localAiPlugin } from '#modules/local-ai/plugin';
import { forgetServerAnswers, settleEvals } from '#modules/local-ai/service';
import { forgetVoiceVocabulary, resetVoiceQuotas } from '../../service';
import { wav } from '../fixtures';

// hub/voice-2 end to end (docs/helena-decisions/voice-2.md): the owner's voice settings, the
// voice on the GPU (whisper.cpp's server for the ear, qwentts.cpp's for the voice) behind fakes,
// spoken chat turns, and Helena's voice reply answering or handing a spoken question to the
// agent.

process.env.AGENT_CHAT_CLAIM_WAIT_MS = '50';
process.env.AGENT_CHAT_CLAIM_POLL_MS = '10';

const KEY = 'test-voice-2-key';
let fake: ReturnType<typeof Bun.serve>;
const received: { path: string; form?: Record<string, string>; json?: Record<string, unknown> }[] =
  [];
let whisperReply: Record<string, unknown> = { text: 'Hallo Helena, wie spät ist es?' };

// The voice reply's model: answers what the conversation answers, hands over the rest.
const HAND_OVER = /Aufgabe|Mail|Kalender|Docker|Koordinator|Merk dir|Wetter|Server-Update genau/;
function replyTo(prompt: string): { text: string } | { handOver: true } {
  const said = prompt.split('The person says now:').at(-1) ?? '';
  if (HAND_OVER.test(said)) return { handOver: true };
  if (/spät/.test(said)) return { text: 'Es ist gerade 14:35.' };
  if (/kürzer/.test(said)) return { text: 'Kurz: Steuerberater, Checkout-Freigabe, Server-Update.' };
  if (/Hauptstadt/.test(said)) return { text: 'Die Hauptstadt von Australien ist Canberra.' };
  return { text: 'Ja, ich höre dich gut.' };
}

function sse(chunks: unknown[]): Response {
  const body = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

async function chatCompletion(request: Request): Promise<Response> {
  const body = (await request.json()) as {
    stream?: boolean;
    messages: { role: string; content: string }[];
  };
  const prompt = body.messages.at(-1)?.content ?? '';
  received.push({ path: '/api/v1/chat/completions', json: body as Record<string, unknown> });
  const reply = replyTo(prompt);
  if (!body.stream) {
    return Response.json({
      choices: [
        {
          finish_reason: 'handOver' in reply ? 'tool_calls' : 'stop',
          message:
            'handOver' in reply
              ? {
                  content: null,
                  tool_calls: [{ function: { name: 'hand_to_agent', arguments: '{}' } }],
                }
              : { content: reply.text },
        },
      ],
      usage: { prompt_tokens: 300, completion_tokens: 12 },
    });
  }
  if ('handOver' in reply)
    return sse([
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'hand_to_agent' } }] } }] },
    ]);
  const words = reply.text.split(/(?<= )/);
  return sse([
    ...words.map((word) => ({ choices: [{ delta: { content: word } }] })),
    { choices: [], usage: { prompt_tokens: 320, completion_tokens: words.length } },
  ]);
}

// 16-bit PCM of `samples` samples, split into chunks that cut a sample in half.
function pcmChunks(samples: number): Uint8Array[] {
  const bytes = new Uint8Array(samples * 2);
  return [bytes.subarray(0, 101), bytes.subarray(101, 2001), bytes.subarray(2001)];
}

beforeAll(async () => {
  fake = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const path = url.pathname;
      // Lemonade (with a key): the voice reply's model.
      if (path.startsWith('/api/v1/')) {
        if (request.headers.get('authorization') !== `Bearer ${KEY}`)
          return new Response('no', { status: 401 });
        if (path === '/api/v1/health')
          return Response.json({ status: 'ok', version: '2026.39.1', all_models_loaded: [] });
        if (path === '/api/v1/system-stats') return Response.json({});
        if (path === '/api/v1/models')
          return Response.json({
            data: [
              {
                id: 'Qwen3.6-35B-A3B-GGUF',
                recipe: 'llamacpp',
                labels: ['tool-calling'],
                downloaded: true,
              },
            ],
          });
        if (path === '/api/v1/chat/completions') return chatCompletion(request);
      }
      // whisper.cpp's whisper-server (no key), `--request-path /v1`.
      if (path === '/w/v1/health') return Response.json({ status: 'ok' });
      if (path === '/w/v1/audio/transcriptions') {
        const form = await request.formData();
        const fields: Record<string, string> = {};
        for (const [name, value] of form.entries())
          if (typeof value === 'string') fields[name] = value;
        received.push({ path, form: fields });
        return Response.json(whisperReply);
      }
      // qwentts.cpp's tts-server (no key).
      if (path === '/q/v1/models') return Response.json({ data: [{ id: 'qwen3-tts' }] });
      if (path === '/q/v1/audio/voices')
        return Response.json({ voices: [{ name: 'helena' }, { name: 'vivian' }] });
      if (path === '/q/v1/audio/speech') {
        const json = (await request.json()) as Record<string, unknown>;
        received.push({ path, json });
        const chunks = pcmChunks(4800);
        return new Response(
          new ReadableStream({
            start(controller) {
              for (const chunk of chunks) controller.enqueue(chunk);
              controller.close();
            },
          }),
          { headers: { 'content-type': 'audio/pcm' } },
        );
      }
      return new Response('not found', { status: 404 });
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
  forgetVoiceVocabulary();
  forgetServerAnswers();
  received.length = 0;
  whisperReply = { text: 'Hallo Helena, wie spät ist es?' };
});

async function setup() {
  const owner = await signUpTestUser({ name: 'Patrick Owner' });
  const asOwner = authedApi(owner.cookie);
  await asOwner.projects.post({ key: 'VERVE', name: 'Verve' });
  const created = await createAgent(asOwner, 'VERVE', {
    name: 'Vera',
    username: 'vera',
    kind: 'external',
  });
  const base = `http://127.0.0.1:${fake.port}`;
  expect(
    (
      await asOwner.god['local-ai'].servers.post({
        kind: 'whisper-cpp',
        slug: 'ear',
        baseUrl: `${base}/w/v1`,
        keySource: 'none',
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await asOwner.god['local-ai'].servers.post({
        kind: 'qwentts-cpp',
        slug: 'voice',
        baseUrl: `${base}/q/v1`,
        keySource: 'none',
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await asOwner.god['local-ai'].servers.post({
        kind: 'lemonade',
        slug: 'local',
        baseUrl: `${base}/api/v1`,
        keySource: 'stored',
        key: KEY,
      })
    ).status,
  ).toBe(200);
  await asOwner.god['local-ai'].policy.patch({ enabled: true, preset: 'eigene' });
  return {
    owner,
    asOwner,
    agent: created.data!.agent,
    asAgent: apiKeyApi(created.data!.apiKey!),
  };
}

function upload(cookie: string, audio: Uint8Array, language = 'de') {
  const form = new FormData();
  form.append('file', new Blob([audio], { type: 'audio/wav' }), 'recording.wav');
  form.append('language', language);
  return app.handle(
    new Request('http://localhost/voice/transcriptions', {
      method: 'POST',
      headers: { cookie },
      body: form,
    }),
  );
}

const chatOf = (api: Api, agentId: number) =>
  api.projects({ projectKey: 'VERVE' })['ai-agents']({ agentId });

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const value = await read();
    if (done(value)) return value;
    await Bun.sleep(10);
  }
  throw new Error('timed out');
}

describe('voice settings', () => {
  it('are the owner’s, with what the browser needs in the status', async () => {
    const { owner, asOwner } = await setup();
    const member = await signUpTestUser({ name: 'Mia' });
    expect((await authedApi(member.cookie).god.voice.settings.get()).status).toBe(403);

    const first = (await asOwner.god.voice.settings.get()).data!;
    expect(first).toMatchObject({ pauseMs: 600, vocabulary: [], voice: null, speed: 1 });
    // Helena knows its own names, the agents' and the projects' (a key that only differs in
    // case from the name is the same word).
    expect(first.helenaWords).toEqual(expect.arrayContaining(['Helena', 'Vera', 'Verve']));
    expect(first.voices).toEqual([]);

    const changed = await asOwner.god.voice.settings.patch({
      pauseMs: 900,
      vocabulary: ['Steuerberater Müller', 'Shopify', 'shopify', '  '],
    });
    expect(changed.status).toBe(200);
    expect(changed.data).toMatchObject({
      pauseMs: 900,
      vocabulary: ['Steuerberater Müller', 'Shopify'],
    });
    expect((await authedApi(owner.cookie).voice.get()).data!.settings).toEqual({
      pauseMs: 900,
      speed: 1,
    });
    expect((await asOwner.god.voice.settings.patch({ pauseMs: 50 })).status).toBe(422);
  });
});

describe('the ear on the GPU (whisper.cpp)', () => {
  it('sends the words to know, and drops what Whisper was not sure is speech', async () => {
    const { owner, asOwner } = await setup();
    await asOwner.god.voice.settings.patch({ vocabulary: ['Steuerberater Müller'] });
    await asOwner.god['local-ai'].policy.patch({
      classes: { transcription: { mode: 'prefer', model: 'helena-ear/whisper' } },
    });
    const heard = await upload(owner.cookie, wav(2));
    expect(heard.status).toBe(200);
    expect(await heard.json()).toMatchObject({
      text: 'Hallo Helena, wie spät ist es?',
      dropped: null,
      model: 'helena-ear/whisper',
    });
    const form = received.find((entry) => entry.path === '/w/v1/audio/transcriptions')!.form!;
    expect(form).toMatchObject({
      model: 'whisper',
      language: 'de',
      temperature: '0',
      response_format: 'verbose_json',
    });
    // The owner's words first, then Helena's.
    expect(form.prompt!.startsWith('Steuerberater Müller, Helena')).toBe(true);
    expect(form.prompt).toContain('Verve');

    // A segment Whisper itself doubts is speech is dropped; the confident one stays.
    whisperReply = {
      text: 'Danke. Untertitel',
      segments: [
        { text: 'Danke.', no_speech_prob: 0.1, avg_logprob: -0.2 },
        { text: ' Untertitel', no_speech_prob: 0.9, avg_logprob: -1.4 },
      ],
    };
    expect(await (await upload(owner.cookie, wav(2))).json()).toMatchObject({ text: 'Danke.' });

    // Another language than the one asked for is not the owner's sentence.
    whisperReply = { text: 'Was that huge budget line on Canada?' };
    expect(await (await upload(owner.cookie, wav(2))).json()).toMatchObject({
      text: '',
      dropped: 'other-language',
    });
    whisperReply = { text: 'Thank you.' };
    expect(await (await upload(owner.cookie, wav(1))).json()).toMatchObject({
      text: '',
      dropped: 'hallucination',
    });
  });
});

describe('the voice on the GPU (qwentts.cpp)', () => {
  it('streams PCM as it is made, in the chosen voice and the page’s language', async () => {
    const { owner, asOwner } = await setup();
    await asOwner.god['local-ai'].policy.patch({
      classes: { speech: { mode: 'prefer', model: 'helena-voice/qwen3-tts' } },
    });
    expect((await asOwner.god.voice.settings.get()).data!.voices).toEqual(['helena', 'vivian']);
    await asOwner.god.voice.settings.patch({ voice: 'helena' });
    const audio = await app.handle(
      new Request('http://localhost/voice/speech', {
        method: 'POST',
        headers: { cookie: owner.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'Guten Morgen.', language: 'de' }),
      }),
    );
    expect(audio.status).toBe(200);
    expect(audio.headers.get('content-type')).toBe('audio/pcm');
    expect(audio.headers.get('x-helena-sample-rate')).toBe('24000');
    expect(audio.headers.get('x-helena-model')).toBe('helena-voice/qwen3-tts');
    // Every sample whole, whatever the chunks the server sent.
    expect((await audio.arrayBuffer()).byteLength).toBe(9600);
    expect(received.find((entry) => entry.path === '/q/v1/audio/speech')!.json).toEqual({
      model: 'qwen3-tts',
      input: 'Guten Morgen.',
      response_format: 'pcm',
      voice: 'helena',
      language: 'German',
      seed: 7,
    });
  });
});

describe('spoken turns', () => {
  it('ask the agent for a short spoken answer, on the model set for conversations', async () => {
    const { asOwner, agent, asAgent } = await setup();
    await asAgent['agent-chats'].catalog.post({
      models: [
        {
          id: 'gpt-5.6-luna',
          name: 'GPT-5.6 Luna',
          reasoning: true,
          thinkingLevels: ['low', 'high'],
          thinkingDefault: 'low',
        },
      ],
    });
    const settings = (
      await asOwner.god.voice.settings.patch({
        replyModel: 'gpt-5.6-luna',
        replyThinkingLevel: 'low',
      })
    ).data!;
    expect(settings.replyModels.map((model) => model.id)).toContain('gpt-5.6-luna');

    const sent = await chatOf(asOwner, agent.id).chat.post({
      prompt: 'Wie viele Aufgaben hat Verve?',
      via: 'voice',
    });
    expect(sent.status).toBe(200);
    const claimed = (await asAgent['agent-chats'].claim.post()).data!.message!;
    expect(claimed.prompt).toStartWith('[Said in a voice conversation');
    expect(claimed.prompt).toEndWith('Wie viele Aufgaben hat Verve?');
    expect(claimed.model).toBe('gpt-5.6-luna');
    expect(claimed.thinkingLevel).toBe('low');

    // A typed question stays as it was.
    await asAgent['agent-chats']({ messageId: claimed.id }).result.post({ status: 'success' });
    await chatOf(asOwner, agent.id).chat.post({
      prompt: 'Und getippt?',
      threadId: sent.data!.threadId,
    });
    const typed = (await asAgent['agent-chats'].claim.post()).data!.message!;
    expect(typed.prompt).not.toContain('voice conversation');
  });
});

describe('the voice reply', () => {
  async function switchOn(asOwner: Api) {
    const body = { classId: 'voice-reply', modelId: 'helena-local/Qwen3.6-35B-A3B-GGUF' };
    expect((await asOwner.god['local-ai'].evals.post(body)).status).toBe(202);
    await settleEvals();
    const evaluated = (await asOwner.god['local-ai'].get()).data!.evals.find(
      (entry) => entry.classId === 'voice-reply',
    );
    expect(evaluated).toMatchObject({ passed: true, score: 1 });
    const on = await asOwner.god['local-ai'].policy.patch({
      classes: { 'voice-reply': { mode: 'prefer', model: body.modelId } },
    });
    expect(on.status).toBe(200);
  }

  it('answers what the conversation answers itself, fast and marked', async () => {
    const { asOwner, agent, asAgent } = await setup();
    await switchOn(asOwner);
    const sent = await chatOf(asOwner, agent.id).chat.post({
      prompt: 'Hallo, hörst du mich?',
      via: 'voice',
    });
    const threadId = sent.data!.threadId;
    const thread = chatOf(asOwner, agent.id).threads({ threadId });
    const items = await until(
      async () => (await thread.messages.get()).data!.items,
      (list) => list.some((item) => item.role === 'assistant' && item.durationMs != null),
    );
    const answer = items.find((item) => item.role === 'assistant')!;
    expect(answer.parts).toEqual([{ type: 'text', text: 'Ja, ich höre dich gut.' }]);
    expect(answer.model).toBe('helena-local/Qwen3.6-35B-A3B-GGUF');
    expect(answer.via).toBe('voice');
    expect(items.find((item) => item.role === 'user')?.via).toBe('voice');
    // The agent's runner never saw it.
    expect((await asAgent['agent-chats'].claim.post()).data!.message).toBeNull();
    // The model heard the conversation's names and the question, and could only hand over.
    const request = received
      .filter((entry) => entry.path === '/api/v1/chat/completions')
      .at(-1)!.json as { stream: boolean; tools: { function: { name: string } }[] };
    expect(request.stream).toBe(true);
    expect(request.tools.map((tool) => tool.function.name)).toEqual(['hand_to_agent']);
  });

  it('hands what needs the agent to its runner at once', async () => {
    const { asOwner, agent, asAgent } = await setup();
    await switchOn(asOwner);
    await chatOf(asOwner, agent.id).chat.post({
      prompt: 'Wie viele offene Aufgaben hat Verve?',
      via: 'voice',
    });
    const claimed = await until(
      async () => (await asAgent['agent-chats'].claim.post()).data!.message,
      (message) => message !== null,
    );
    expect(claimed!.prompt).toStartWith('[Said in a voice conversation');
    expect(claimed!.model).not.toBe('helena-local/Qwen3.6-35B-A3B-GGUF');
  });

  it('leaves typed questions and switched-off classes alone', async () => {
    const { asOwner, agent, asAgent } = await setup();
    await chatOf(asOwner, agent.id).chat.post({ prompt: 'Hallo, hörst du mich?', via: 'voice' });
    // Off: the runner takes a spoken question right away.
    expect((await asAgent['agent-chats'].claim.post()).data!.message).not.toBeNull();
    expect(received.some((entry) => entry.path === '/api/v1/chat/completions')).toBe(false);
  });
});
