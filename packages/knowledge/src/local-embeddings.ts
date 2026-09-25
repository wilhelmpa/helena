import { readModelServerKey, resolveLocalRoute } from '@repo/db';
import { createOpenAiEmbedder, type EmbeddingRoute } from './vectors';

// Embeddings from Helena's local AI (docs/helena-decisions/local-ai-platform.md §6): while the
// master switch and the `embeddings` task class are on, passages and queries are embedded by
// the local model server (Lemonade, the NPU or the GPU) instead of the in-process model. The
// vectors are named after the local model, so switching either way embeds again. While the
// server does not answer, the same model stays chosen (another model's vectors are another
// space): the search answers from full text and the indexer tries again.
//
// The API and the worker set it: useEmbeddingRoute(localAiEmbeddingRoute).

export const EMBEDDINGS_CLASS = 'embeddings';

export async function localAiEmbeddingRoute(): Promise<EmbeddingRoute | null> {
  const result = await resolveLocalRoute({
    classId: EMBEDDINGS_CLASS,
    unit: 'npu',
    capability: 'embeddings',
    requireUp: false,
  });
  if (!('route' in result)) return null;
  const { server, model, modelId } = result.route;
  return {
    id: modelId,
    async create() {
      const apiKey = await readModelServerKey(server);
      const probe = createOpenAiEmbedder({
        id: modelId,
        baseUrl: server.baseUrl,
        model,
        apiKey,
        dims: 0,
        timeoutMs: 20_000,
      });
      const [vector] = await probe.embed(['probe'], 'passage');
      return createOpenAiEmbedder({
        id: modelId,
        baseUrl: server.baseUrl,
        model,
        apiKey,
        dims: vector?.length ?? 0,
      });
    },
  };
}
