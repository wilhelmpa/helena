import { ROUTER_TIERS, type RouterTier } from '#modules/decisions/questions';

// Which models of an agent's runtime the router may choose between, and how capable each is
// (docs/helena-decisions/decisions.md §4). The decision model rates how hard a request is on a
// fixed scale (light < standard < strong < strongest); the router then takes the cheapest
// model whose tier covers that, among the models of the same provider as the configured one
// that the agent's catalog offers and nobody refused. Never a stronger (dearer) model than the
// configured one, unless the owner allowed an upgrade for the agent — then at most one tier up.
//
// A model's tier comes from its name where the family is known (Claude: haiku, sonnet, opus,
// fable; the common light suffixes mini, nano, flash, lite), otherwise from its price rank
// among the provider's models, counted from the cheapest: the cheapest is `light`, the next
// `standard`, and so on. Counting from the bottom is the careful reading: with two models the
// dearer one covers everything above `light`, so only light requests move down.

export interface RouterModel {
  id: string;
  provider?: string;
  // Input price per million tokens; null when the price table has none.
  inputPrice: number | null;
  thinkingLevels?: string[];
  thinkingDefault?: string | null;
}

export interface TieredModel extends RouterModel {
  tier: RouterTier;
}

const NAMED: [RegExp, RouterTier][] = [
  [/fable/i, 'strongest'],
  [/opus/i, 'strong'],
  [/sonnet/i, 'standard'],
  [/haiku|(^|[-_.])(mini|nano|lite|flash)([-_.]|$)/i, 'light'],
];

export function namedTier(id: string): RouterTier | null {
  for (const [pattern, tier] of NAMED) if (pattern.test(id)) return tier;
  return null;
}

export function tierRank(tier: RouterTier): number {
  return ROUTER_TIERS.indexOf(tier);
}

// The models the router may choose from, each with its tier: the configured model and the
// others of its provider with a known price (a model without one cannot be compared).
export function tieredModels(configured: RouterModel, catalog: RouterModel[]): TieredModel[] {
  const provider = configured.provider ?? null;
  const sameProvider = catalog.filter(
    (model) =>
      model.id !== configured.id &&
      (model.provider ?? null) === provider &&
      model.inputPrice !== null &&
      Number.isFinite(model.inputPrice),
  );
  const all = [configured, ...sameProvider];
  const priced = all
    .filter((model) => model.inputPrice !== null)
    .map((model) => model.inputPrice!)
    .sort((a, b) => a - b);
  const levels = [...new Set(priced)];
  return all.map((model) => {
    const named = namedTier(model.id);
    if (named) return { ...model, tier: named };
    const rank = model.inputPrice === null ? levels.length - 1 : levels.indexOf(model.inputPrice);
    return { ...model, tier: ROUTER_TIERS[Math.max(0, Math.min(3, rank))]! };
  });
}

export interface RouteChoice {
  model: TieredModel;
  // cheaper_tier | upgrade | same_tier | no_candidates
  reason: 'cheaper_tier' | 'upgrade' | 'same_tier' | 'no_candidates';
}

// The model for a request of difficulty `needed`: the cheapest model whose tier covers it and
// that costs less than the configured one; the configured one when none does; one tier above
// the configured one only where an upgrade is allowed and the configured tier is too low.
export function chooseModel(
  configured: RouterModel,
  catalog: RouterModel[],
  needed: RouterTier,
  allowUpgrade: boolean,
): RouteChoice {
  const models = tieredModels(configured, catalog);
  const own = models.find((model) => model.id === configured.id)!;
  const price = (model: RouterModel) => model.inputPrice ?? Number.POSITIVE_INFINITY;
  if (models.length < 2) return { model: own, reason: 'no_candidates' };
  const covers = (model: TieredModel) => tierRank(model.tier) >= tierRank(needed);
  if (!covers(own)) {
    if (!allowUpgrade) return { model: own, reason: 'same_tier' };
    const above = models
      .filter((model) => price(model) > price(own) && covers(model))
      .filter((model) => tierRank(model.tier) <= tierRank(own.tier) + 1)
      .sort((a, b) => price(a) - price(b))[0];
    return above ? { model: above, reason: 'upgrade' } : { model: own, reason: 'same_tier' };
  }
  const cheaper = models
    .filter((model) => model.id !== own.id && price(model) < price(own) && covers(model))
    .sort((a, b) => price(a) - price(b))[0];
  return cheaper ? { model: cheaper, reason: 'cheaper_tier' } : { model: own, reason: 'same_tier' };
}

// The reasoning level to run a routed model with: the configured one where the model has it,
// else the model's own default.
export function thinkingFor(model: RouterModel, configured: string | null): string | null {
  if (!model.thinkingLevels?.length) return configured;
  if (configured && model.thinkingLevels.includes(configured)) return configured;
  return model.thinkingDefault ?? null;
}
