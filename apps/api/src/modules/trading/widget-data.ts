import {
  approvalRequest,
  appSetting,
  db,
  helenaDecision,
  helenaDecisionClassSetting,
  integrationCredential,
  vaultEntry,
} from '@repo/db';
import { and, desc, eq, gte, inArray, or, sql } from 'drizzle-orm';
import {
  AlpacaPaperClient,
  AlpacaError,
  NotPaperError,
  num,
  readKeys,
  readLimits,
  tradingDay,
  TRADING_DECISION_CLASSES,
  type AlpacaOrder,
} from '@helena/trading';
import { credentialValues } from '#modules/agents/integrations/service';
import { connectionIsLocal, loadConnection } from '#modules/browser-task/connection';
import { HttpError } from '#shared/lib';
import { periodStart, type TradingPeriod } from './dashboard-values';
import { tradingDashboardData } from './dashboard';

type WidgetResult = { data: unknown; error: null } | { data: null; error: string };
type WidgetId = 'account' | 'positions' | 'orders' | 'history' | 'strategies' | 'decisions';
export const widgetIds: WidgetId[] = [
  'account',
  'positions',
  'orders',
  'history',
  'strategies',
  'decisions',
];

const cache = new Map<string, { until: number; value: WidgetResult }>();
export function clearTradingWidgetCache(): void {
  cache.clear();
}
async function cached(key: string, work: () => Promise<unknown>): Promise<WidgetResult> {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  try {
    const value: WidgetResult = { data: await work(), error: null };
    cache.set(key, { until: Date.now() + 15_000, value });
    return value;
  } catch (error) {
    return {
      data: null,
      error:
        error instanceof HttpError
          ? error.message
          : error instanceof AlpacaError
            ? `Alpaca paper API returned HTTP ${error.status}.`
            : error instanceof NotPaperError
              ? 'Only a paper connection can be used.'
              : 'Trading data could not be loaded.',
    };
  }
}

function strategyOf(order: AlpacaOrder): { id: string; version: string } | null {
  const match = order.client_order_id?.match(/^helena-(.+)-v(\d+(?:\.\d+){0,2})-/);
  return match ? { id: match[1]!, version: match[2]! } : null;
}

function orderView(order: AlpacaOrder, journalPath: string | null) {
  return {
    id: order.id,
    clientOrderId: order.client_order_id,
    symbol: order.symbol,
    side: order.side,
    status: order.status,
    type: order.type,
    qty: order.qty === null ? null : num(order.qty),
    limitPrice: order.limit_price === null ? null : num(order.limit_price),
    stopPrice: order.stop_price === null ? null : num(order.stop_price),
    submittedAt: order.submitted_at,
    strategy: strategyOf(order)?.id ?? null,
    strategyVersion: strategyOf(order)?.version ?? null,
    journalPath,
  };
}

async function paperConnection(projectId: number, teamId: number, requestedId?: number) {
  const rows = await db
    .select({ id: integrationCredential.id, projectId: integrationCredential.projectId })
    .from(integrationCredential)
    .where(
      and(
        eq(integrationCredential.teamId, teamId),
        eq(integrationCredential.integrationKey, 'alpaca_paper'),
        or(
          eq(integrationCredential.projectId, projectId),
          sql`${integrationCredential.projectId} IS NULL`,
        ),
      ),
    );
  const scoped = rows.filter((row) => row.projectId === projectId);
  const selected = requestedId
    ? rows.find((row) => row.id === requestedId)
    : scoped.length === 1
      ? scoped[0]
      : rows.length === 1
        ? rows[0]
        : undefined;
  if (!selected)
    throw new HttpError(
      rows.length ? 409 : 404,
      rows.length
        ? 'Select a paper connection for this dashboard.'
        : 'No paper connection is available for this project.',
    );
  const values = await credentialValues(selected.id, teamId);
  if (!values) throw new HttpError(403, 'The paper connection is unavailable.');
  return { id: selected.id, values, client: new AlpacaPaperClient(readKeys(values)) };
}

async function journalPaths(projectId: number) {
  const rows = await db
    .select({ path: vaultEntry.path, frontmatter: vaultEntry.frontmatter })
    .from(vaultEntry)
    .where(
      and(eq(vaultEntry.projectId, projectId), sql`${vaultEntry.frontmatter}->>'typ' = 'trade'`),
    );
  const paths = new Map<string, string>();
  for (const row of rows) {
    for (const id of [row.frontmatter.trade_id, row.frontmatter.order_id])
      if (typeof id === 'string') paths.set(id, row.path);
  }
  return paths;
}

export async function tradingWidgetData(
  project: { id: number; teamId: number; createdAt: string },
  period: TradingPeriod,
  credentialId?: number,
) {
  const scope = `${project.id}:${period}:${credentialId ?? 'auto'}`;
  const local = {
    strategies: cached(`${scope}:strategies`, () => strategies(project.id)),
    decisions: cached(`${scope}:decisions`, () => decisions(project.id, project.teamId, period)),
  };
  let connection: Awaited<ReturnType<typeof paperConnection>>;
  try {
    connection = await paperConnection(project.id, project.teamId, credentialId);
  } catch (error) {
    const message =
      error instanceof HttpError
        ? error.message
        : error instanceof NotPaperError
          ? 'Only a paper connection can be used.'
          : 'Paper connection unavailable.';
    return {
      account: { data: null, error: message },
      positions: { data: null, error: message },
      orders: { data: null, error: message },
      history: { data: null, error: message },
      strategies: await local.strategies,
      decisions: await local.decisions,
    };
  }
  const { client, values } = connection;
  const paperScope = `${scope}:${connection.id}`;
  const allOrders = cached(`${paperScope}:orders-source`, () =>
    client.orders({
      status: 'all',
      limit: 500,
      after: new Date(Date.now() - 26 * 3600_000).toISOString(),
    }),
  );
  const latestOrders = cached(`${paperScope}:latest-source`, () =>
    client.orders({ status: 'all', limit: 500 }),
  );
  const openOrders = cached(`${paperScope}:open-source`, () =>
    client.orders({ status: 'open', limit: 500 }),
  );
  const results = await Promise.all([
    cached(`${paperScope}:account`, async () => {
      const [account, orders] = await Promise.all([client.account(), allOrders]);
      if (orders.error) throw new HttpError(502, orders.error);
      if ((orders.data as AlpacaOrder[]).length >= 500)
        throw new HttpError(502, 'The daily paper order list is incomplete.');
      const today = tradingDay(new Date());
      const ordersToday = (orders.data as AlpacaOrder[]).filter(
        (order) => order.submitted_at && tradingDay(new Date(order.submitted_at)) === today,
      ).length;
      const equity = num(account.equity);
      const lastEquity = num(account.last_equity);
      const { limits, missing } = readLimits(values);
      return {
        status: account.status,
        currency: account.currency,
        equity,
        cash: num(account.cash),
        buyingPower: num(account.buying_power),
        dayPnlUsd: equity - lastEquity,
        dayPnlPct: lastEquity ? ((equity - lastEquity) / lastEquity) * 100 : null,
        tradingHalted:
          limits.halted ||
          account.trading_blocked ||
          account.account_blocked ||
          account.status !== 'ACTIVE',
        brokerTradingBlocked: account.trading_blocked || account.account_blocked,
        limits,
        missingLimits: missing,
        ordersToday,
      };
    }),
    cached(`${paperScope}:positions`, async () => {
      const [positions, open, latest, account, approvals] = await Promise.all([
        client.positions(),
        openOrders,
        latestOrders,
        client.account(),
        strategyApprovals(project.id),
      ]);
      if (open.error || latest.error)
        throw new HttpError(502, open.error ?? latest.error ?? 'Orders unavailable.');
      const orders = (open.data as AlpacaOrder[]).flatMap((order) => [
        order,
        ...(order.legs ?? []),
      ]);
      const pastOrders = (latest.data as AlpacaOrder[]).flatMap((order) => [
        order,
        ...(order.legs ?? []),
      ]);
      return positions.map((position) => {
        const related = orders.filter((order) => order.symbol === position.symbol);
        const protectiveSide = position.side === 'short' ? 'buy' : 'sell';
        const entrySide = position.side === 'short' ? 'sell' : 'buy';
        const stop = related.find(
          (order) => order.side === protectiveSide && order.stop_price != null,
        );
        const strategy =
          pastOrders
            .filter(
              (order) =>
                order.symbol === position.symbol &&
                order.side === entrySide &&
                Number(order.filled_qty) > 0,
            )
            .map(strategyOf)
            .find(Boolean) ??
          related.map(strategyOf).find(Boolean) ??
          null;
        const approval = approvals.find(
          (entry) =>
            strategy !== null &&
            entry.strategyId === strategy.id &&
            entry.version === strategy.version &&
            entry.accountId === account.id,
        );
        return {
          symbol: position.symbol,
          qty: num(position.qty),
          entryPrice: num(position.avg_entry_price),
          currentPrice: num(position.current_price),
          unrealizedPnlUsd: num(position.unrealized_pl),
          unrealizedPnlPct: num(position.unrealized_plpc) * 100,
          stopPrice: stop?.stop_price ? num(stop.stop_price) : null,
          stopOrderId: stop?.id ?? null,
          strategy: strategy?.id ?? null,
          strategyVersion: strategy?.version ?? null,
          approvalStatus: approval?.status ?? null,
        };
      });
    }),
    cached(`${paperScope}:orders`, async () => {
      const [todayOrders, recent, open, paths] = await Promise.all([
        allOrders,
        latestOrders,
        openOrders,
        journalPaths(project.id),
      ]);
      if (todayOrders.error || recent.error || open.error)
        throw new HttpError(
          502,
          todayOrders.error ?? recent.error ?? open.error ?? 'Orders unavailable.',
        );
      const today = tradingDay(new Date());
      const view = (order: AlpacaOrder) =>
        orderView(order, paths.get(order.id) ?? paths.get(order.client_order_id) ?? null);
      const latest = recent.data as AlpacaOrder[];
      return {
        today: (todayOrders.data as AlpacaOrder[])
          .filter(
            (order) => order.submitted_at && tradingDay(new Date(order.submitted_at)) === today,
          )
          .map(view),
        open: (open.data as AlpacaOrder[]).map(view),
        recent: latest.slice(0, 30).map(view),
      };
    }),
    cached(`${paperScope}:history:${period}`, async () => {
      const query =
        period === 'today'
          ? ({ period: '1D', timeframe: '5Min' } as const)
          : period === 'week'
            ? ({ period: '1W', timeframe: '1H' } as const)
            : ({ start: project.createdAt, timeframe: '1D' } as const);
      const history = await client.portfolioHistory(query);
      if (history.timestamp.length !== history.equity.length)
        throw new HttpError(502, 'Incomplete portfolio history.');
      return {
        currency: 'USD',
        period,
        points: history.timestamp.map((time, index) => ({
          time: new Date(time * 1000).toISOString(),
          equity: history.equity[index],
          profitLoss: history.profit_loss[index] ?? null,
          profitLossPct:
            history.profit_loss_pct[index] == null ? null : history.profit_loss_pct[index]! * 100,
        })),
      };
    }),
    local.strategies,
    local.decisions,
  ]);
  return Object.fromEntries(widgetIds.map((id, index) => [id, results[index]]));
}

async function strategyApprovals(projectId: number) {
  const rows = await db
    .select({
      id: approvalRequest.id,
      status: approvalRequest.status,
      payload: approvalRequest.payload,
      createdAt: approvalRequest.createdAt,
      decidedAt: approvalRequest.decidedAt,
    })
    .from(approvalRequest)
    .where(
      and(
        eq(approvalRequest.projectId, projectId),
        sql`${approvalRequest.payload}->>'type' = 'trading-strategy'`,
      ),
    )
    .orderBy(desc(approvalRequest.id));
  return rows.map((row) => {
    const payload = row.payload as Record<string, unknown>;
    return {
      id: row.id,
      status: row.status,
      accountId: String(payload.accountId ?? ''),
      strategyId: String(payload.strategyId ?? ''),
      version: String(payload.strategyVersion ?? ''),
      path: String(payload.path ?? ''),
      createdAt: row.createdAt.toISOString(),
      decidedAt: row.decidedAt?.toISOString() ?? null,
    };
  });
}

async function strategies(projectId: number) {
  const [notes, approvals] = await Promise.all([
    db
      .select({ path: vaultEntry.path, frontmatter: vaultEntry.frontmatter })
      .from(vaultEntry)
      .where(
        and(
          eq(vaultEntry.projectId, projectId),
          sql`${vaultEntry.frontmatter}->>'typ' = 'strategie'`,
        ),
      ),
    strategyApprovals(projectId),
  ]);
  return {
    items: notes.map(({ path, frontmatter }) => ({
      path,
      id: String(frontmatter.strategie ?? ''),
      version: String(frontmatter.version ?? ''),
      status: String(frontmatter.status ?? 'entwurf'),
      backtest: typeof frontmatter.backtest === 'string' ? frontmatter.backtest : null,
      approval:
        approvals.find(
          (entry) =>
            entry.strategyId === frontmatter.strategie &&
            entry.version === String(frontmatter.version),
        ) ?? null,
    })),
    approvals,
  };
}

async function decisions(projectId: number, teamId: number, period: TradingPeriod) {
  const classIds = TRADING_DECISION_CLASSES.map((entry) => entry.id);
  const start = periodStart(period);
  const [rows, settings, [jev], dashboard] = await Promise.all([
    db
      .select({
        classId: helenaDecision.classId,
        status: helenaDecision.status,
        credentialId: helenaDecision.credentialId,
        createdAt: helenaDecision.createdAt,
      })
      .from(helenaDecision)
      .where(
        and(
          eq(helenaDecision.projectId, projectId),
          inArray(helenaDecision.classId, classIds),
          start ? gte(helenaDecision.createdAt, start) : undefined,
        ),
      ),
    db
      .select({
        classId: helenaDecisionClassSetting.classId,
        fallbackId: helenaDecisionClassSetting.fallbackCredentialId,
      })
      .from(helenaDecisionClassSetting)
      .where(
        and(
          eq(helenaDecisionClassSetting.teamId, teamId),
          inArray(helenaDecisionClassSetting.classId, classIds),
        ),
      ),
    db
      .select({ value: appSetting.value })
      .from(appSetting)
      .where(eq(appSetting.key, `decisions.jev-first-stage.team.${teamId}`))
      .limit(1),
    tradingDashboardData(projectId, teamId, period),
  ]);
  const jevId = (jev?.value as { credentialId?: number } | undefined)?.credentialId;
  const ids = [
    ...new Set(rows.map((row) => row.credentialId).filter((id): id is number => id != null)),
  ];
  const connections = await Promise.all(ids.map((id) => loadConnection(id)));
  const localIds = new Set(
    connections
      .filter((entry) => entry?.teamId === teamId && connectionIsLocal(entry))
      .map((entry) => entry!.credentialId),
  );
  return {
    classes: classIds.map((classId) => {
      const fallbackId = settings.find((setting) => setting.classId === classId)?.fallbackId;
      const entries = rows.filter((row) => row.classId === classId);
      const count = (source: 'jev' | 'local' | 'other', status: string) =>
        entries.filter(
          (row) =>
            (source === 'jev'
              ? row.credentialId === jevId && jevId != null
              : source === 'local'
                ? row.credentialId != null &&
                  row.credentialId !== jevId &&
                  localIds.has(row.credentialId)
                : row.credentialId == null ||
                  (row.credentialId !== jevId && !localIds.has(row.credentialId))) &&
            row.status === status,
        ).length;
      return {
        classId,
        jev: { safe: count('jev', 'decided'), unsure: count('jev', 'unsure') },
        local: { safe: count('local', 'decided'), unsure: count('local', 'unsure') },
        other: { safe: count('other', 'decided'), unsure: count('other', 'unsure') },
        fallback: entries.filter((row) => fallbackId != null && row.credentialId === fallbackId)
          .length,
      };
    }),
    vetos: dashboard.vetos.count,
  };
}
