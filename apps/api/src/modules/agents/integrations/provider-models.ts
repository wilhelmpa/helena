import { modelsDevRegistry } from '#shared/models-dev';

// Per-provider model lists, sourced from the models.dev registry through the one shared
// loader (shared/models-dev.ts, which the model price table reads as well); the model
// select in the agent config UI reads it through listModelsForProvider.
// A model id the user types by hand is still accepted downstream, so a failed fetch only
// means the UI shows no suggestions, never a hard error.

export interface ProviderModel {
  id: string;
  name: string;
}

// Shape of the parts of the models.dev payload this module reads.
interface ModelsDevProvider {
  models?: Record<string, { name?: string; status?: string } | undefined>;
}

let derived: { from: Record<string, unknown>; byProvider: Map<string, ProviderModel[]> } | null =
  null;

function modelsByProvider(data: Record<string, unknown>): Map<string, ProviderModel[]> {
  if (derived?.from === data) return derived.byProvider;
  const byProvider = new Map<string, ProviderModel[]>();
  for (const [providerId, value] of Object.entries(data)) {
    const info = value as ModelsDevProvider | undefined;
    if (!info || typeof info !== 'object' || !info.models) continue;
    const models = Object.entries(info.models)
      .filter(([, m]) => m?.status !== 'deprecated')
      .map(([id, m]) => ({ id, name: m?.name || id }))
      .sort((a, b) => a.id.localeCompare(b.id));
    if (models.length > 0) byProvider.set(providerId, models);
  }
  derived = { from: data, byProvider };
  return byProvider;
}

async function getRegistry(): Promise<Map<string, ProviderModel[]>> {
  try {
    return modelsByProvider(await modelsDevRegistry());
  } catch (err) {
    console.error('[integrations] failed to load models.dev registry:', err);
    throw err;
  }
}

// Models known for a provider key, sorted by id. Empty when the provider is not in the
// registry or the registry could not be loaded.
export async function listModelsForProvider(provider: string): Promise<ProviderModel[]> {
  try {
    const registry = await getRegistry();
    return registry.get(provider) ?? [];
  } catch {
    return [];
  }
}
