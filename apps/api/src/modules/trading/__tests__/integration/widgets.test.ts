import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { db, projectDashboard, vaultEntry } from '@repo/db';
import { eq } from 'drizzle-orm';
import { authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { createCredential } from '#tests/helpers/integrations';
import { addProjectMember } from '#tests/helpers/members';
import { createRole } from '#tests/helpers/roles';
import { ensureExistingTradingDashboards, tradingLayout } from '../../dashboard';
import { clearTradingWidgetCache } from '../../widget-data';
import { tradingManifest } from '../../plugin';

const originalFetch = globalThis.fetch;
const paper = {
  keyId: 'PKTEST1234567890',
  secretKey: 'synthetic-paper-test',
  maxOrderValueUsd: 1000,
  maxPositionValueUsd: 2000,
  maxRiskPerTradeUsd: 50,
  dailyLossLimitUsd: 150,
};
const order = {
  id: 'order-1',
  client_order_id: 'helena-orb-spy-v1.0-123',
  symbol: 'SPY',
  side: 'buy',
  type: 'limit',
  status: 'filled',
  qty: '1',
  notional: null,
  filled_qty: '1',
  filled_avg_price: '500',
  limit_price: '500',
  stop_price: null,
  time_in_force: 'day',
  submitted_at: new Date().toISOString(),
  filled_at: null,
  canceled_at: null,
  legs: [],
};
const stopOrder = {
  ...order,
  id: 'stop-1',
  client_order_id: 'stop-1',
  side: 'sell',
  type: 'stop',
  status: 'new',
  stop_price: '490',
  limit_price: null,
  submitted_at: new Date(Date.now() - 86_400_000).toISOString(),
};

async function setup() {
  const owner = await signUpTestUser();
  const api = authedApi(owner.cookie);
  const created = await api.projects.post({ key: 'TRADE', name: 'Trade' });
  return { api, projectId: created.data!.id, teamId: created.data!.teamId };
}

beforeEach(async () => {
  await resetDb();
  clearTradingWidgetCache();
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('Trading dashboard widgets', () => {
  it('registers every widget slot in the plugin manifest', () => {
    expect(tradingManifest().provides.uiSlots).toHaveLength(tradingLayout.length);
  });

  it('seeds once and only upgrades the untouched previous default layout', async () => {
    const { projectId } = await setup();
    await ensureExistingTradingDashboards();
    await ensureExistingTradingDashboards();
    const read = () =>
      db.select().from(projectDashboard).where(eq(projectDashboard.projectId, projectId));
    let rows = await read();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.layout).toEqual(tradingLayout);
    await db
      .update(projectDashboard)
      .set({ layout: tradingLayout.slice(0, 3) })
      .where(eq(projectDashboard.id, rows[0]!.id));
    await ensureExistingTradingDashboards();
    rows = await read();
    expect(rows[0]!.layout).toEqual(tradingLayout);
    const custom = [{ ...tradingLayout[0], x: 3 }, ...tradingLayout.slice(1)];
    await db
      .update(projectDashboard)
      .set({ layout: custom })
      .where(eq(projectDashboard.id, rows[0]!.id));
    await ensureExistingTradingDashboards();
    expect((await read())[0]!.layout).toEqual(custom);
  });

  it('requires the configured-tool read permission in addition to dashboard read', async () => {
    const { api } = await setup();
    const role = await createRole(api, 'TRADE', {
      name: 'Dashboard only',
      permissions: { dashboards: { read: true } },
    });
    const member = await addProjectMember(api, 'TRADE', role.data!.id);
    const result = await member
      .projects({ projectKey: 'TRADE' })
      .trading.widgets.get({ query: { period: 'today' } });
    expect(result.status).toBe(403);
  });

  it('returns paper account, positions, orders, history and journal references', async () => {
    const { api, projectId } = await setup();
    const historyUrls: URL[] = [];
    await createCredential(api, 'TRADE', { integrationKey: 'alpaca_paper', credential: paper });
    await db.insert(vaultEntry).values({
      path: 'Projects/TRADE/Docs/Journal/trade.md',
      projectId,
      kind: 'note',
      title: 'Trade',
      frontmatter: { typ: 'trade', order_id: 'order-1' },
    });
    globalThis.fetch = Object.assign(
      async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const url = new URL(String(input));
        expect(url.hostname).toBe('paper-api.alpaca.markets');
        expect(init?.method).toBe('GET');
        const path = url.pathname;
        if (path === '/v2/account')
          return Response.json({
            id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            status: 'ACTIVE',
            currency: 'USD',
            equity: '10100',
            last_equity: '10000',
            cash: '5000',
            buying_power: '10000',
            trading_blocked: false,
            account_blocked: false,
          });
        if (path === '/v2/positions')
          return Response.json([
            {
              symbol: 'SPY',
              qty: '1',
              side: 'long',
              avg_entry_price: '500',
              current_price: '510',
              unrealized_pl: '10',
              unrealized_plpc: '0.02',
            },
          ]);
        if (path === '/v2/orders')
          return Response.json(
            url.searchParams.get('status') === 'open' ? [stopOrder] : [order, stopOrder],
          );
        if (path === '/v2/account/portfolio/history') {
          historyUrls.push(url);
          return Response.json({
            timestamp: [1760000000],
            equity: [10000],
            profit_loss: [0],
            profit_loss_pct: [0],
          });
        }
        throw new Error(`Unexpected paper path: ${path}`);
      },
      { preconnect: originalFetch.preconnect },
    );
    const response = await api
      .projects({ projectKey: 'TRADE' })
      .trading.widgets.get({ query: { period: 'today' } });
    expect(response.status).toBe(200);
    const data = response.data!;
    expect(data.account.error).toBeNull();
    expect(data.account.data).toMatchObject({ equity: 10100, dayPnlUsd: 100, ordersToday: 1 });
    expect(data.positions.data).toMatchObject([
      { symbol: 'SPY', qty: 1, unrealizedPnlUsd: 10, stopPrice: 490, strategy: 'orb-spy' },
    ]);
    expect(data.orders.data).toMatchObject({
      today: [
        { id: 'order-1', strategy: 'orb-spy', journalPath: 'Projects/TRADE/Docs/Journal/trade.md' },
      ],
    });
    expect(data.history.data).toMatchObject({ period: 'today', points: [{ equity: 10000 }] });
    expect(historyUrls.at(-1)?.searchParams.get('period')).toBe('1D');
    const pilot = await api
      .projects({ projectKey: 'TRADE' })
      .trading.widgets.get({ query: { period: 'pilot' } });
    expect(pilot.data?.history.error).toBeNull();
    expect(historyUrls.at(-1)?.searchParams.get('start')).toBeTruthy();
    expect(historyUrls.at(-1)?.searchParams.has('period')).toBe(false);
  });

  it('shows broker failures per widget while keeping local sections available', async () => {
    const { api } = await setup();
    await createCredential(api, 'TRADE', { integrationKey: 'alpaca_paper', credential: paper });
    globalThis.fetch = Object.assign(
      async () => Response.json({ message: 'synthetic failure' }, { status: 503 }),
      { preconnect: originalFetch.preconnect },
    );
    const response = await api
      .projects({ projectKey: 'TRADE' })
      .trading.widgets.get({ query: { period: 'week' } });
    expect(response.status).toBe(200);
    expect(response.data?.account.error).toBeTruthy();
    expect(response.data?.history.error).toBeTruthy();
    expect(response.data?.strategies.error).toBeNull();
    expect(response.data?.decisions.error).toBeNull();
  });
});
