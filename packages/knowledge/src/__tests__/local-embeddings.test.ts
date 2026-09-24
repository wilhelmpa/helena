import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import {
  activeEmbedder,
  createOpenAiEmbedder,
  semanticRetriever,
  syncEmbedder,
  useEmbedder,
  useEmbeddingRoute,
} from '../vectors';

// Embeddings from a local model server (docs/helena-decisions/local-ai-platform.md §6): the
// OpenAI-compatible `/embeddings` call, the route that picks it, and full text while the
// server does not answer.

let fake: ReturnType<typeof Bun.serve>;
let up = true;

beforeAll(() => {
  fake = Bun.serve({
    port: 0,
    async fetch(request) {
      if (!up) return new Response('down', { status: 503 });
      if (request.headers.get('authorization') !== 'Bearer k')
        return new Response('no', { status: 401 });
      const body = (await request.json()) as { input: string[] };
      // Out of order on purpose: the index says where each vector belongs.
      const data = body.input
        .map((text, index) => ({ index, embedding: [text.length, 1, 0] }))
        .reverse();
      return Response.json({ data });
    },
  });
});

afterAll(() => fake.stop(true));
afterEach(() => {
  useEmbeddingRoute(null);
  useEmbedder(null);
  up = true;
});

const base = () => `http://127.0.0.1:${fake.port}/api/v1`;

describe('local embeddings', () => {
  it('asks the server with its key and returns unit vectors in order', async () => {
    const embedder = createOpenAiEmbedder({
      id: 'helena-local/E',
      baseUrl: base(),
      model: 'E',
      apiKey: 'k',
      dims: 3,
    });
    const vectors = await embedder.embed(['abc', 'a'], 'passage');
    expect(vectors[0]![0]).toBeCloseTo(3 / Math.sqrt(10));
    expect(vectors[1]![0]).toBeCloseTo(1 / Math.sqrt(2));
    const wrongKey = createOpenAiEmbedder({
      id: 'helena-local/E',
      baseUrl: base(),
      model: 'E',
      apiKey: 'x',
      dims: 3,
    });
    await expect(wrongKey.embed(['a'], 'query')).rejects.toThrow('HTTP 401');
  });

  it('takes the routed embedder and leaves it when the route ends', async () => {
    let routed = true;
    useEmbeddingRoute(async () =>
      routed
        ? {
            id: 'helena-local/E',
            create: async () =>
              createOpenAiEmbedder({
                id: 'helena-local/E',
                baseUrl: base(),
                model: 'E',
                apiKey: 'k',
                dims: 3,
              }),
          }
        : null,
    );
    expect((await syncEmbedder())?.id).toBe('helena-local/E');
    // The search runs on it without the Administrator's own switch …
    const retriever = await semanticRetriever();
    expect(retriever).not.toBeNull();
    // … and answers nothing (full text alone) while the server is down.
    up = false;
    const hits = await retriever!({ q: 'x', readable: () => true, filters: {}, limit: 5 } as never);
    expect(hits).toEqual([]);
    routed = false;
    await syncEmbedder();
    expect(activeEmbedder()).toBeNull();
  });
});
