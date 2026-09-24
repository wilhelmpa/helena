// The one models.dev loader (https://models.dev/api.json, MIT): the registry of providers,
// models and prices that the model pickers and the model price table both read. Fetched at
// most once a day and shared by concurrent callers; a failed fetch serves the last good
// copy when there is one. `fresh` fetches now, for the owner's "update the prices".

export const MODELS_DEV_URL = 'https://models.dev/api.json';
const TTL_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 20_000;

let cache: { data: Record<string, unknown>; at: number } | null = null;
let inflight: Promise<Record<string, unknown>> | null = null;

async function fetchRegistry(fetchImpl: typeof fetch): Promise<Record<string, unknown>> {
  const response = await fetchImpl(MODELS_DEV_URL, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`models.dev responded ${response.status}`);
  const data = (await response.json()) as unknown;
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new Error('models.dev sent no registry');
  return data as Record<string, unknown>;
}

export async function modelsDevRegistry(
  options: { fresh?: boolean; fetchImpl?: typeof fetch } = {},
): Promise<Record<string, unknown>> {
  if (!options.fresh && cache && Date.now() - cache.at < TTL_MS) return cache.data;
  if (options.fresh && options.fetchImpl) {
    const data = await fetchRegistry(options.fetchImpl);
    cache = { data, at: Date.now() };
    return data;
  }
  inflight ??= fetchRegistry(options.fetchImpl ?? fetch)
    .then((data) => {
      cache = { data, at: Date.now() };
      return data;
    })
    .catch((error: unknown) => {
      if (cache && !options.fresh) return cache.data;
      throw error;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
