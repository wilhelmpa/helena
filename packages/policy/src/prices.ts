import snapshot from './prices/models-dev-snapshot.json';

// Model prices for cost estimates (docs/helena-decisions/policy-engine.md): models.dev is the
// source (MIT, https://models.dev/api.json, the list Hermes caches too). A snapshot of the
// providers Helena's runners offer ships with Helena, so a fresh install has prices without
// network access; the owner can import the current list and override any row by hand.

// Dollars per million tokens, as models.dev lists them.
export interface UsdPrice {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface ModelsDevEntry extends UsdPrice {
  provider: string;
  // The price above 200k tokens of context, where models.dev lists one.
  longContext?: UsdPrice;
}

// The providers whose models are imported, in order of preference when two list the same
// id. openai-codex, the provider name the Codex runner reports, is openai here.
export const PRICE_PROVIDERS = ['anthropic', 'openai', 'google', 'deepseek', 'mistral', 'xai'];

export const PROVIDER_ALIASES: Record<string, string> = {
  'openai-codex': 'openai',
  codex: 'openai',
  claude: 'anthropic',
  gemini: 'google',
};

// Models models.dev does not list yet, from their providers' own price pages: TypeSafe's Jev
// (docs.typesafe.ai/models: $0.042 per million input tokens, output free), answered directly
// or through the Vercel AI Gateway, which reports it as typesafe-ai/jev. Both imports add them;
// a manual row still wins.
export const EXTRA_PRICES: Record<string, ModelsDevEntry> = {
  'jev-1.13.0': { provider: 'typesafe', input: 0.042, output: 0 },
  'jev-latest': { provider: 'typesafe', input: 0.042, output: 0 },
  'jev-preview': { provider: 'typesafe', input: 0.042, output: 0 },
  jev: { provider: 'typesafe', input: 0.042, output: 0 },
};

function withExtras(prices: Map<string, ModelsDevEntry>): Map<string, ModelsDevEntry> {
  for (const [id, entry] of Object.entries(EXTRA_PRICES))
    if (!prices.has(id)) prices.set(id, entry);
  return prices;
}

// The shipped snapshot: model id (lower case) → price.
export function snapshotPrices(): Map<string, ModelsDevEntry> {
  return withExtras(new Map(Object.entries(snapshot.models as Record<string, ModelsDevEntry>)));
}

interface ModelsDevApi {
  [provider: string]: {
    models?: Record<
      string,
      {
        cost?: {
          input?: number;
          output?: number;
          cache_read?: number;
          cache_write?: number;
          context_over_200k?: {
            input?: number;
            output?: number;
            cache_read?: number;
            cache_write?: number;
          };
        };
      }
    >;
  };
}

function usd(cost: {
  input?: number;
  output?: number;
  cache_read?: number;
  cache_write?: number;
}): UsdPrice | null {
  if (typeof cost.input !== 'number' || typeof cost.output !== 'number') return null;
  return {
    input: cost.input,
    output: cost.output,
    ...(typeof cost.cache_read === 'number' && { cacheRead: cost.cache_read }),
    ...(typeof cost.cache_write === 'number' && { cacheWrite: cost.cache_write }),
  };
}

// The prices of models.dev's api.json for the imported providers, by model id.
export function pricesFromModelsDev(api: unknown): Map<string, ModelsDevEntry> {
  const result = new Map<string, ModelsDevEntry>();
  const data = (api ?? {}) as ModelsDevApi;
  for (const provider of PRICE_PROVIDERS) {
    for (const [id, model] of Object.entries(data[provider]?.models ?? {})) {
      const base = model.cost ? usd(model.cost) : null;
      const key = id.toLowerCase();
      if (!base || result.has(key)) continue;
      const long = model.cost?.context_over_200k ? usd(model.cost.context_over_200k) : null;
      result.set(key, { provider, ...base, ...(long && { longContext: long }) });
    }
  }
  return withExtras(result);
}

// The ids a reported model id may be listed under, most exact first: as it is, with dots as
// dashes (claude-fable-5.1 → claude-fable-5-1), without a provider prefix, and without a
// context-size suffix (gpt-6-luna-900k → gpt-6-luna, priced at its long-context tier).
export function priceCandidates(model: string): { id: string; longContext: boolean }[] {
  const ids: { id: string; longContext: boolean }[] = [];
  const add = (id: string, longContext = false) => {
    if (id && !ids.some((entry) => entry.id === id)) ids.push({ id, longContext });
  };
  const lower = model.trim().toLowerCase();
  const bare = lower.includes('/') ? lower.slice(lower.lastIndexOf('/') + 1) : lower;
  for (const id of [lower, bare]) {
    add(id);
    add(id.replace(/\./g, '-'));
  }
  for (const id of [lower, bare]) {
    const cut = id.replace(/-\d+(k|m)$/, '');
    if (cut !== id) {
      add(cut, true);
      add(cut.replace(/\./g, '-'), true);
    }
  }
  return ids;
}

export function normalizeProvider(provider: string | null | undefined): string | null {
  if (!provider) return null;
  const lower = provider.toLowerCase();
  return PROVIDER_ALIASES[lower] ?? lower;
}

// Token counts in the OpenTelemetry GenAI sense: input includes what was read from and
// written to the cache, output includes reasoning.
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
}

// Per million tokens, in one currency.
export interface PricePerMTok {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number | null;
  cacheWritePerMTok: number | null;
}

// What the usage cost at these prices. Cached tokens are billed at their own price where
// the model has one, otherwise at the input price.
export function costOf(usage: TokenUsage, price: PricePerMTok): number {
  const cacheRead = Math.max(0, usage.cacheReadTokens ?? 0);
  const cacheWrite = Math.max(0, usage.cacheWriteTokens ?? 0);
  const fresh = Math.max(0, usage.inputTokens - cacheRead - cacheWrite);
  const total =
    fresh * price.inputPerMTok +
    cacheRead * (price.cacheReadPerMTok ?? price.inputPerMTok) +
    cacheWrite * (price.cacheWritePerMTok ?? price.inputPerMTok) +
    Math.max(0, usage.outputTokens) * price.outputPerMTok;
  return total / 1_000_000;
}

// A dollar price in euros at the owner's rate, rounded to the table's precision.
export function toEur(price: UsdPrice, usdToEur: number): PricePerMTok {
  const eur = (value: number | undefined) =>
    value === undefined ? null : Math.round(value * usdToEur * 1_000_000) / 1_000_000;
  return {
    inputPerMTok: eur(price.input)!,
    outputPerMTok: eur(price.output)!,
    cacheReadPerMTok: eur(price.cacheRead),
    cacheWritePerMTok: eur(price.cacheWrite),
  };
}

// The default exchange rate, euros per dollar; the owner sets the real one in Administrator.
export const DEFAULT_USD_TO_EUR = 0.86;
