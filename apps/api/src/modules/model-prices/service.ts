import { db, getSetting, helenaModelPrice, setSetting } from '@repo/db';
import { eq, ne, sql } from 'drizzle-orm';
import {
  costOf as costAtPrice,
  DEFAULT_USD_TO_EUR,
  normalizeProvider,
  priceCandidates,
  pricesFromModelsDev,
  snapshotPrices,
  toEur,
  type ModelsDevEntry,
  type TokenUsage,
  type UsdPrice,
} from '@helena/policy';
import { HttpError } from '#shared/lib';
import { modelsDevRegistry } from '#shared/models-dev';
import { isLocalProvider, parseLocalModelId } from '@helena/sdk';

// The model price table (docs/helena-decisions/policy-engine.md): euros per million tokens
// per model, for estimating what agents spend. Every price is an estimate. Rows come from
// models.dev, converted from dollars at the owner's rate, unless the owner entered them by
// hand; an import never touches a manual row. Consumed by the Autopilot budgets and by the
// cost views (hub/hermes-in-helena) through price() and costOf().

const SETTING_KEY = 'helena.model_prices';
// Other processes (the worker) change nothing here, so a short cache only has to catch up
// with this process's own writes, which clear it.
const CACHE_MS = 60_000;

export interface ModelPrice {
  model: string;
  provider: string | null;
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number | null;
  cacheWritePerMTok: number | null;
  currency: 'EUR';
  // `local`: a model of Helena's local AI, which costs nothing per token.
  source: 'models.dev' | 'manual' | 'local';
  estimate: true;
}

export interface ModelPriceSettings {
  // Euros per dollar, for the models.dev prices.
  usdToEur: number;
  // When the table was last filled from models.dev, and from where: the snapshot shipped
  // with Helena or the live list.
  importedAt: string | null;
  importedFrom: 'snapshot' | 'models.dev' | null;
}

type PriceRow = typeof helenaModelPrice.$inferSelect;

let cache: { rows: Map<string, PriceRow>; usdToEur: number; at: number } | null = null;
let seeding: Promise<void> | null = null;

export async function getModelPriceSettings(): Promise<ModelPriceSettings> {
  const stored = await getSetting<Partial<ModelPriceSettings>>(SETTING_KEY);
  return {
    usdToEur:
      typeof stored?.usdToEur === 'number' && stored.usdToEur > 0
        ? stored.usdToEur
        : DEFAULT_USD_TO_EUR,
    importedAt: stored?.importedAt ?? null,
    importedFrom: stored?.importedFrom ?? null,
  };
}

function rowValues(model: string, entry: ModelsDevEntry, usdToEur: number) {
  const eur = toEur(entry, usdToEur);
  const sourceUsd: UsdPrice & { longContext?: UsdPrice } = {
    input: entry.input,
    output: entry.output,
    ...(entry.cacheRead !== undefined && { cacheRead: entry.cacheRead }),
    ...(entry.cacheWrite !== undefined && { cacheWrite: entry.cacheWrite }),
    ...(entry.longContext && { longContext: entry.longContext }),
  };
  return {
    model,
    provider: entry.provider,
    inputEurPerM: eur.inputPerMTok,
    outputEurPerM: eur.outputPerMTok,
    cacheReadEurPerM: eur.cacheReadPerMTok,
    cacheWriteEurPerM: eur.cacheWritePerMTok,
    source: 'models.dev' as const,
    sourceUsd,
    updatedByUserId: null,
    updatedAt: new Date(),
  };
}

// Writes the models.dev prices over every row that is not manual. Returns how many rows it
// wrote and how many manual rows it left alone.
async function writeImported(
  prices: Map<string, ModelsDevEntry>,
  from: 'snapshot' | 'models.dev',
): Promise<{ imported: number; keptManual: number }> {
  const settings = await getModelPriceSettings();
  const manual = new Set(
    (
      await db
        .select({ model: helenaModelPrice.model })
        .from(helenaModelPrice)
        .where(eq(helenaModelPrice.source, 'manual'))
    ).map((row) => row.model),
  );
  const values = [...prices.entries()]
    .filter(([model]) => !manual.has(model))
    .map(([model, entry]) => rowValues(model, entry, settings.usdToEur));
  for (let start = 0; start < values.length; start += 200) {
    await db
      .insert(helenaModelPrice)
      .values(values.slice(start, start + 200))
      .onConflictDoUpdate({
        target: helenaModelPrice.model,
        set: {
          provider: sql`excluded.provider`,
          inputEurPerM: sql`excluded.input_eur_per_m`,
          outputEurPerM: sql`excluded.output_eur_per_m`,
          cacheReadEurPerM: sql`excluded.cache_read_eur_per_m`,
          cacheWriteEurPerM: sql`excluded.cache_write_eur_per_m`,
          sourceUsd: sql`excluded.source_usd`,
          updatedAt: sql`now()`,
        },
        setWhere: ne(helenaModelPrice.source, 'manual'),
      });
  }
  await setSetting(SETTING_KEY, {
    ...settings,
    importedAt: new Date().toISOString(),
    importedFrom: from,
  });
  cache = null;
  return {
    imported: values.length,
    keptManual: [...prices.keys()].filter((m) => manual.has(m)).length,
  };
}

// A fresh install fills the table from the snapshot once, the first time a price is read.
async function ensureSeeded(): Promise<void> {
  if ((await getModelPriceSettings()).importedFrom !== null) return;
  seeding ??= writeImported(snapshotPrices(), 'snapshot')
    .then(() => undefined)
    .finally(() => {
      seeding = null;
    });
  await seeding;
}

async function table(): Promise<{ rows: Map<string, PriceRow>; usdToEur: number }> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache;
  await ensureSeeded();
  let all = await db.select().from(helenaModelPrice);
  const known = new Set(all.map((row) => row.model));
  const settings = await getModelPriceSettings();
  const missing = [...snapshotPrices()].filter(([model]) => !known.has(model));
  for (let start = 0; start < missing.length; start += 200) {
    await db
      .insert(helenaModelPrice)
      .values(
        missing
          .slice(start, start + 200)
          .map(([model, entry]) => rowValues(model, entry, settings.usdToEur)),
      )
      .onConflictDoNothing();
  }
  if (missing.length) all = await db.select().from(helenaModelPrice);
  const { usdToEur } = await getModelPriceSettings();
  cache = { rows: new Map(all.map((row) => [row.model, row])), usdToEur, at: Date.now() };
  return cache;
}

// Forgets what was read, for a test that writes the table directly.
export function clearModelPriceCache(): void {
  cache = null;
}

function toPrice(row: PriceRow, longContext: boolean, usdToEur: number): ModelPrice {
  const long = (row.sourceUsd as { longContext?: UsdPrice } | null)?.longContext;
  const eur =
    longContext && long && row.source === 'models.dev'
      ? toEur(long, usdToEur)
      : {
          inputPerMTok: row.inputEurPerM,
          outputPerMTok: row.outputEurPerM,
          cacheReadPerMTok: row.cacheReadEurPerM,
          cacheWritePerMTok: row.cacheWriteEurPerM,
        };
  return {
    model: row.model,
    provider: row.provider,
    ...eur,
    currency: 'EUR',
    source: row.source as ModelPrice['source'],
    estimate: true,
  };
}

function localPrice(model: string, provider: string | null | undefined): ModelPrice {
  return {
    model,
    provider: provider ?? parseLocalModelId(model)?.provider ?? null,
    inputPerMTok: 0,
    outputPerMTok: 0,
    cacheReadPerMTok: 0,
    cacheWritePerMTok: 0,
    currency: 'EUR',
    source: 'local',
    estimate: true,
  };
}

// The price of a model as a runtime reports it, or null when the table has none. Tried in
// order: the id as it is, with dots as dashes, without a provider prefix, and without a
// context-size suffix (priced at the long-context tier where models.dev lists one). A row
// of the named provider wins over one of another provider.
export async function price(
  modelId: string | null | undefined,
  provider?: string | null,
): Promise<ModelPrice | null> {
  if (!modelId?.trim()) return null;
  // Helena's local AI runs on the owner's machine: no price per token
  // (docs/helena-decisions/local-ai-platform.md).
  if (
    provider === 'local' ||
    modelId === 'volition-local-default' ||
    isLocalProvider(provider) ||
    parseLocalModelId(modelId)
  )
    return localPrice(modelId, provider);
  const { rows, usdToEur } = await table();
  const wanted = normalizeProvider(provider);
  let fallback: ModelPrice | null = null;
  for (const candidate of priceCandidates(modelId)) {
    const row = rows.get(candidate.id);
    if (!row) continue;
    const found = toPrice(row, candidate.longContext, usdToEur);
    if (!wanted || !row.provider || row.provider === wanted) return found;
    fallback ??= found;
  }
  return fallback;
}

// What the usage cost at the model's price, in euros, or null when the model has no price.
export async function costOfUsage(
  model: string | null | undefined,
  provider: string | null | undefined,
  usage: TokenUsage,
): Promise<number | null> {
  const found = await price(model, provider);
  return found ? costAtPrice(usage, found) : null;
}

export { costAtPrice as costOf };

export interface ModelPriceRow extends ModelPrice {
  updatedAt: string;
  // The dollar prices an imported row was converted from.
  usd: UsdPrice | null;
}

export async function listModelPrices(): Promise<{
  items: ModelPriceRow[];
  settings: ModelPriceSettings;
}> {
  const { rows } = await table();
  const settings = await getModelPriceSettings();
  const items = [...rows.values()]
    .sort(
      (a, b) =>
        (a.provider ?? '').localeCompare(b.provider ?? '') || a.model.localeCompare(b.model),
    )
    .map((row) => {
      const usd = row.sourceUsd as (UsdPrice & { longContext?: UsdPrice }) | null;
      return {
        ...toPrice(row, false, settings.usdToEur),
        updatedAt: row.updatedAt.toISOString(),
        usd: usd
          ? {
              input: usd.input,
              output: usd.output,
              ...(usd.cacheRead !== undefined && { cacheRead: usd.cacheRead }),
              ...(usd.cacheWrite !== undefined && { cacheWrite: usd.cacheWrite }),
            }
          : null,
      };
    });
  return { items, settings };
}

export interface ManualPriceInput {
  provider?: string | null;
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok?: number | null;
  cacheWritePerMTok?: number | null;
}

// The owner's own price for a model, which no import overwrites.
export async function setManualPrice(
  model: string,
  input: ManualPriceInput,
  userId: string,
): Promise<ModelPriceRow> {
  const id = model.trim().toLowerCase();
  if (!id) throw new HttpError(400, 'A model id is required');
  const values = {
    model: id,
    provider: normalizeProvider(input.provider) ?? null,
    inputEurPerM: input.inputPerMTok,
    outputEurPerM: input.outputPerMTok,
    cacheReadEurPerM: input.cacheReadPerMTok ?? null,
    cacheWriteEurPerM: input.cacheWritePerMTok ?? null,
    source: 'manual' as const,
    updatedByUserId: userId,
    updatedAt: new Date(),
  };
  await db
    .insert(helenaModelPrice)
    .values(values)
    .onConflictDoUpdate({ target: helenaModelPrice.model, set: values });
  cache = null;
  return (await listModelPrices()).items.find((row) => row.model === id)!;
}

// Removes the owner's price of a model. The models.dev price takes its place again when the
// snapshot has one; otherwise the model has no price until the next import lists it.
export async function resetModelPrice(model: string): Promise<boolean> {
  const id = model.trim().toLowerCase();
  const deleted = await db
    .delete(helenaModelPrice)
    .where(eq(helenaModelPrice.model, id))
    .returning({ model: helenaModelPrice.model });
  const known = snapshotPrices().get(id);
  if (known) {
    const settings = await getModelPriceSettings();
    await db.insert(helenaModelPrice).values(rowValues(id, known, settings.usdToEur));
  }
  cache = null;
  return deleted.length > 0;
}

// Fills the table from the live models.dev list (or, with `snapshot`, from the list that
// ships with Helena). Manual rows stay as they are.
export async function importModelPrices(
  from: 'models.dev' | 'snapshot',
  fetchImpl: typeof fetch = fetch,
): Promise<{ imported: number; keptManual: number; settings: ModelPriceSettings }> {
  let prices: Map<string, ModelsDevEntry>;
  if (from === 'snapshot') {
    prices = snapshotPrices();
  } else {
    let body: unknown;
    try {
      body = await modelsDevRegistry({ fresh: true, fetchImpl });
    } catch (error) {
      throw new HttpError(
        502,
        `Could not read the prices from models.dev: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
    prices = pricesFromModelsDev(body);
    if (prices.size === 0) throw new HttpError(502, 'models.dev listed no prices');
  }
  const result = await writeImported(prices, from);
  return { ...result, settings: await getModelPriceSettings() };
}

// A new exchange rate converts every imported row again from its dollar prices.
export async function setUsdToEur(rate: number): Promise<ModelPriceSettings> {
  if (!(rate > 0 && rate < 100)) throw new HttpError(400, 'The exchange rate must be positive');
  const settings = await getModelPriceSettings();
  await setSetting(SETTING_KEY, { ...settings, usdToEur: rate });
  const imported = await db
    .select()
    .from(helenaModelPrice)
    .where(eq(helenaModelPrice.source, 'models.dev'));
  for (const row of imported) {
    const usd = row.sourceUsd as (UsdPrice & { longContext?: UsdPrice }) | null;
    if (!usd) continue;
    const eur = toEur(usd, rate);
    await db
      .update(helenaModelPrice)
      .set({
        inputEurPerM: eur.inputPerMTok,
        outputEurPerM: eur.outputPerMTok,
        cacheReadEurPerM: eur.cacheReadPerMTok,
        cacheWriteEurPerM: eur.cacheWritePerMTok,
        updatedAt: new Date(),
      })
      .where(eq(helenaModelPrice.model, row.model));
  }
  cache = null;
  return getModelPriceSettings();
}
