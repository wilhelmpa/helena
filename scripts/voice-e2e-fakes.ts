// Fakes for the voice E2E (scripts/voice-e2e.mjs, docs/helena-decisions/voice-2.md §8): one
// loopback server standing in for the three model servers Helena's voice talks to, with the
// latencies measured on Kingston's GPU, so the E2E measures what Helena itself adds (the ear in
// the browser, the API, the chat stream, the voice's playback):
//
//   /api/v1  Lemonade (key): the voice reply's model — answers what the conversation answers,
//            calls hand_to_agent for the rest; streamed, first token after REPLY_TTFT_MS;
//   /w/v1    whisper.cpp's server: every recording is "Hallo Home, wie spät ist es?" (or
//            FAKE_TRANSCRIPT), after STT_MS;
//   /q/v1    qwentts.cpp's server: a tone as 24 kHz PCM, the first chunk after TTS_FIRST_MS,
//            then in real time.
//
//   bun scripts/voice-e2e-fakes.ts <port> <lemonade key>
const [portArg, key = 'voice-e2e-key'] = process.argv.slice(2);
const STT_MS = Number(process.env.STT_MS ?? 250);
const REPLY_TTFT_MS = Number(process.env.REPLY_TTFT_MS ?? 250);
const TTS_FIRST_MS = Number(process.env.TTS_FIRST_MS ?? 150);
const TRANSCRIPT = process.env.FAKE_TRANSCRIPT ?? 'Hallo Home, wie spät ist es?';
const RATE = 24_000;

const HAND_OVER = /Aufgabe|Mail|Kalender|Docker|Koordinator|Merk dir|Wetter|Server-Update genau/;
function replyTo(prompt: string): { text: string } | { handOver: true } {
  const said = prompt.split('The person says now:').at(-1) ?? '';
  if (HAND_OVER.test(said)) return { handOver: true };
  if (/spät/.test(said)) return { text: 'Es ist gerade 14:35. Brauchst du noch etwas?' };
  if (/kürzer/.test(said)) return { text: 'Kurz: Steuerberater, Checkout-Freigabe, Server-Update.' };
  if (/Hauptstadt/.test(said)) return { text: 'Die Hauptstadt von Australien ist Canberra.' };
  return { text: 'Ja, ich höre dich gut.' };
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const encoder = new TextEncoder();

function sse(write: (controller: ReadableStreamDefaultController<Uint8Array>) => Promise<void>) {
  return new Response(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        await write(controller);
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
}

async function chat(request: Request): Promise<Response> {
  const body = (await request.json()) as { stream?: boolean; messages: { content: string }[] };
  const reply = replyTo(body.messages.at(-1)?.content ?? '');
  if (!body.stream) {
    return Response.json({
      choices: [
        {
          message:
            'handOver' in reply
              ? { content: null, tool_calls: [{ function: { name: 'hand_to_agent', arguments: '{}' } }] }
              : { content: reply.text },
        },
      ],
      usage: { prompt_tokens: 300, completion_tokens: 12 },
    });
  }
  return sse(async (controller) => {
    const send = (chunk: unknown) =>
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
    await sleep(REPLY_TTFT_MS);
    if ('handOver' in reply) {
      send({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'hand_to_agent' } }] } }] });
      return;
    }
    // ~50 tokens/s, as Qwen3.6-35B-A3B generates on the 8060S.
    for (const word of reply.text.split(/(?<= )/)) {
      send({ choices: [{ delta: { content: word } }] });
      await sleep(20);
    }
  });
}

// A soft tone of `seconds`, as 16-bit PCM, sent as it would be generated.
function tone(seconds: number): Response {
  const total = Math.round(seconds * RATE);
  const chunk = Math.round(RATE * 0.08);
  return new Response(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        await sleep(TTS_FIRST_MS);
        for (let at = 0; at < total; at += chunk) {
          const n = Math.min(chunk, total - at);
          const bytes = new Uint8Array(n * 2);
          const view = new DataView(bytes.buffer);
          for (let i = 0; i < n; i += 1)
            view.setInt16(i * 2, Math.round(Math.sin(((at + i) / RATE) * 2 * Math.PI * 220) * 3000), true);
          controller.enqueue(bytes);
          // Faster than real time (RTF ~0.3), like the GPU.
          await sleep(25);
        }
        controller.close();
      },
    }),
    { headers: { 'content-type': 'audio/pcm' } },
  );
}

const server = Bun.serve({
  port: Number(portArg ?? 25602),
  hostname: '127.0.0.1',
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/api/v1/')) {
      if (request.headers.get('authorization') !== `Bearer ${key}`)
        return new Response('no', { status: 401 });
      if (path === '/api/v1/health')
        return Response.json({ status: 'ok', version: 'fake', all_models_loaded: [] });
      if (path === '/api/v1/system-stats') return Response.json({});
      if (path === '/api/v1/models')
        return Response.json({
          data: [{ id: 'Qwen3.6-35B-A3B-GGUF', recipe: 'llamacpp', labels: ['tool-calling'], downloaded: true }],
        });
      if (path === '/api/v1/chat/completions') return chat(request);
    }
    if (path === '/w/v1/health') return Response.json({ status: 'ok' });
    if (path === '/w/v1/audio/transcriptions') {
      const form = await request.formData();
      const file = form.get('file');
      if (!(file instanceof Blob) || file.size < 44) return new Response('bad', { status: 400 });
      await sleep(STT_MS);
      return Response.json({
        text: TRANSCRIPT,
        segments: [{ text: TRANSCRIPT, no_speech_prob: 0.01, avg_logprob: -0.2 }],
      });
    }
    if (path === '/q/v1/models') return Response.json({ data: [{ id: 'qwen3-tts' }] });
    if (path === '/q/v1/health') return Response.json({ status: 'ok' });
    if (path === '/q/v1/audio/voices') return Response.json({ voices: [{ name: 'helena' }] });
    if (path === '/q/v1/audio/speech') {
      const body = (await request.json()) as { input: string };
      // About 14 characters a second of speech.
      return tone(Math.max(0.6, body.input.length / 14));
    }
    return new Response('not found', { status: 404 });
  },
});
console.log(`voice fakes on ${server.url}`);
