import { beforeEach, describe, expect, it } from 'bun:test';
import { authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { EXTRA_PRICES } from '@helena/policy';
import {
  clearModelPriceCache,
  costOf,
  importModelPrices,
  price,
} from '#modules/model-prices/service';

// The model price table: seeded from the models.dev snapshot that ships with Helena, edited
// by the instance owner, never overwritten where the owner set a price by hand, and read by
// the budgets and the cost views through price() and costOf().

describe('model prices', () => {
  beforeEach(async () => {
    await resetDb();
    clearModelPriceCache();
  });

  it('seeds the table from the models.dev snapshot on first read, in euros', async () => {
    const god = authedApi((await signUpTestUser({ name: 'Owner' })).cookie);
    const list = (await god['model-prices'].get()).data!;
    expect(list.settings).toMatchObject({ usdToEur: 0.86, importedFrom: 'snapshot' });
    const opus = list.items.find((item) => item.model === 'claude-opus-5')!;
    expect(opus).toMatchObject({
      provider: 'anthropic',
      source: 'models.dev',
      currency: 'EUR',
      estimate: true,
      usd: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    });
    expect(opus.inputPerMTok).toBeCloseTo(4.3, 6);
    expect(opus.outputPerMTok).toBeCloseTo(21.5, 6);
  });

  it('finds a model by the id a runtime reports', async () => {
    expect((await price('claude-fable-5.1'))?.model).toBe('claude-fable-5-1');
    expect((await price('anthropic/claude-sonnet-5'))?.model).toBe('claude-sonnet-5');
    const long = (await price('gpt-6-luna-900k', 'openai-codex'))!;
    const base = (await price('gpt-6-luna'))!;
    expect(long.model).toBe('gpt-6-luna');
    expect(long.inputPerMTok).toBeGreaterThan(base.inputPerMTok);
    expect(await price('no-such-model')).toBeNull();
    expect(costOf({ inputTokens: 1_000_000, outputTokens: 0 }, base)).toBeCloseTo(
      base.inputPerMTok,
      6,
    );
  });

  it('keeps a price the owner set by hand through an import, and resets it on request', async () => {
    const god = authedApi((await signUpTestUser({ name: 'Owner' })).cookie);
    await god['model-prices'].get();
    const set = await god.god['model-prices']({ model: 'claude-opus-5' }).put({
      inputPerMTok: 1,
      outputPerMTok: 2,
    });
    expect(set.data).toMatchObject({ model: 'claude-opus-5', source: 'manual', inputPerMTok: 1 });

    const imported = await importModelPrices('snapshot');
    expect(imported.keptManual).toBe(1);
    expect((await price('claude-opus-5'))!).toMatchObject({ source: 'manual', inputPerMTok: 1 });

    expect((await god.god['model-prices']({ model: 'claude-opus-5' }).delete()).status).toBe(204);
    expect((await price('claude-opus-5'))!).toMatchObject({ source: 'models.dev' });
  });

  it('converts the imported prices again at a new exchange rate', async () => {
    const god = authedApi((await signUpTestUser({ name: 'Owner' })).cookie);
    await god['model-prices'].get();
    const settings = await god.god['model-prices'].settings.put({ usdToEur: 1 });
    expect(settings.data).toMatchObject({ usdToEur: 1 });
    expect((await price('claude-opus-5'))!.inputPerMTok).toBeCloseTo(5, 6);
  });

  it('reads the live list from models.dev and reports a failure', async () => {
    const api = {
      anthropic: { models: { 'claude-new': { cost: { input: 2, output: 8 } } } },
    };
    const ok = (async () => new Response(JSON.stringify(api))) as unknown as typeof fetch;
    // The one listed model, plus the ones models.dev does not list yet (Jev).
    expect((await importModelPrices('models.dev', ok)).imported).toBe(
      1 + Object.keys(EXTRA_PRICES).length,
    );
    expect((await price('claude-new'))!.outputPerMTok).toBeCloseTo(8 * 0.86, 6);
    const down = (async () => new Response('no', { status: 503 })) as unknown as typeof fetch;
    await expect(importModelPrices('models.dev', down)).rejects.toThrow('models.dev');
  });

  it('is the instance owner’s to edit', async () => {
    await signUpTestUser({ name: 'Owner' });
    const member = authedApi((await signUpTestUser({ name: 'Member' })).cookie);
    expect((await member['model-prices'].get()).status).toBe(200);
    expect(
      (await member.god['model-prices']({ model: 'x' }).put({ inputPerMTok: 1, outputPerMTok: 1 }))
        .status,
    ).toBe(403);
    expect((await member.god['model-prices'].import.post({ from: 'snapshot' })).status).toBe(403);
  });
});

it('prices the local alias at zero and fills shipped Jev prices in an already imported table', async () => {
  await resetDb();
  clearModelPriceCache();
  const { db, helenaModelPrice, setSetting } = await import('@repo/db');
  const { eq } = await import('drizzle-orm');
  await price('gpt-6-luna');
  await db.delete(helenaModelPrice).where(eq(helenaModelPrice.model, 'jev-1.13.0'));
  await setSetting('helena.model_prices', { usdToEur: 0.86, importedFrom: 'snapshot' });
  clearModelPriceCache();
  expect(await price('volition-local-default')).toMatchObject({
    inputPerMTok: 0,
    outputPerMTok: 0,
  });
  expect(await price('jev-1.13.0', 'typesafe')).toMatchObject({
    inputPerMTok: 0.042 * 0.86,
    outputPerMTok: 0,
  });
});
