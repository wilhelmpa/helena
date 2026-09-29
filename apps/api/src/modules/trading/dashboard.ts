import {
  customField,
  db,
  helenaDecision,
  helenaDecisionClassSetting,
  helenaSchedule,
  issue,
  issueFieldValue,
  issueType,
  pipelineRun,
  project,
  projectColumn,
  projectDashboard,
  projectViewFolder,
} from '@repo/db';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { isDeepStrictEqual } from 'node:util';
import { nextFireTime } from '#modules/engine/schedules';
import {
  hypotheticalPercent,
  periodStart,
  rsiFromIndicators,
  type TradingPeriod,
} from './dashboard-values';

export const tradingLayout = [
  {
    id: 'trading-kpis',
    type: 'plugin',
    title: 'Kennzahlen',
    x: 0,
    y: 0,
    w: 12,
    h: 3,
    config: { pluginWidgetId: 'plugin:helena.trading:kpis' },
  },
  {
    id: 'trading-watchlist',
    type: 'plugin',
    title: 'Watchlist',
    x: 0,
    y: 3,
    w: 8,
    h: 10,
    config: { pluginWidgetId: 'plugin:helena.trading:watchlist' },
  },
  {
    id: 'trading-takt',
    type: 'plugin',
    title: 'Takt',
    x: 8,
    y: 3,
    w: 4,
    h: 10,
    config: { pluginWidgetId: 'plugin:helena.trading:takt' },
  },
  ...(
    [
      ['account', 'Konto', 0, 13, 6, 6],
      ['positions', 'Offene Positionen', 6, 13, 6, 6],
      ['orders', 'Orders', 0, 19, 6, 8],
      ['history', 'Ergebnis-Verlauf', 6, 19, 6, 8],
      ['strategies', 'Strategien & Freigaben', 0, 27, 6, 8],
      ['decisions', 'Entscheidungen', 6, 27, 6, 8],
    ] as const
  ).map(([id, title, x, y, w, h]) => ({
    id: `trading-${id}`,
    type: 'plugin',
    title,
    x,
    y,
    w,
    h,
    config: { pluginWidgetId: `plugin:helena.trading:${id}` },
  })),
];

export async function ensureTradingDashboard(projectId: number): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${projectId}, 31)`);
    const [existing] = await tx
      .select({ id: projectDashboard.id, layout: projectDashboard.layout })
      .from(projectDashboard)
      .where(and(eq(projectDashboard.projectId, projectId), eq(projectDashboard.name, 'Trading')))
      .limit(1);
    if (existing) {
      const layout = existing.layout as { id?: string }[];
      if (Array.isArray(layout) && isDeepStrictEqual(layout, tradingLayout.slice(0, 3))) {
        await tx
          .update(projectDashboard)
          .set({ layout: tradingLayout })
          .where(eq(projectDashboard.id, existing.id));
      }
      return;
    }
    const [{ position }] = await tx
      .select({ position: sql<number>`COALESCE(MAX(${projectDashboard.position}) + 1, 0)` })
      .from(projectDashboard)
      .where(eq(projectDashboard.projectId, projectId));
    await tx.insert(projectDashboard).values({
      projectId,
      name: 'Trading',
      layout: tradingLayout,
      position: Number(position),
    });
  });
}

export async function ensureExistingTradingDashboards(): Promise<void> {
  const projects = await db
    .select({ id: project.id })
    .from(project)
    .where(eq(project.key, 'TRADE'));
  for (const entry of projects) await ensureTradingDashboard(entry.id);
}

export async function tradingDashboardData(
  projectId: number,
  teamId: number,
  period: TradingPeriod,
) {
  const start = periodStart(period);
  const [cards, fields, decisions, setting, schedules] = await Promise.all([
    db
      .select({
        id: issue.id,
        number: issue.sequenceNumber,
        title: issue.title,
        description: issue.description,
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
        column: projectColumn.name,
        type: issueType.name,
        folder: projectViewFolder.name,
      })
      .from(issue)
      .innerJoin(projectColumn, eq(projectColumn.id, issue.columnId))
      .leftJoin(issueType, eq(issueType.id, issue.typeId))
      .leftJoin(projectViewFolder, eq(projectViewFolder.id, issue.folderId))
      .where(eq(issue.projectId, projectId))
      .orderBy(desc(issue.updatedAt)),
    db
      .select({
        issueId: issueFieldValue.issueId,
        name: customField.name,
        text: issueFieldValue.valueText,
        number: issueFieldValue.valueNumber,
        bool: issueFieldValue.valueBool,
      })
      .from(issueFieldValue)
      .innerJoin(customField, eq(customField.id, issueFieldValue.fieldId))
      .where(eq(customField.projectId, projectId)),
    db
      .select({
        status: helenaDecision.status,
        credentialId: helenaDecision.credentialId,
        createdAt: helenaDecision.createdAt,
      })
      .from(helenaDecision)
      .where(
        and(
          eq(helenaDecision.projectId, projectId),
          eq(helenaDecision.classId, 'helena.trading.news'),
        ),
      ),
    db
      .select({ fallbackCredentialId: helenaDecisionClassSetting.fallbackCredentialId })
      .from(helenaDecisionClassSetting)
      .where(
        and(
          eq(helenaDecisionClassSetting.teamId, teamId),
          eq(helenaDecisionClassSetting.classId, 'helena.trading.news'),
        ),
      )
      .limit(1),
    db
      .select({
        id: helenaSchedule.id,
        title: helenaSchedule.title,
        cron: helenaSchedule.cron,
        timezone: helenaSchedule.timezone,
        enabled: helenaSchedule.enabled,
      })
      .from(helenaSchedule)
      .where(eq(helenaSchedule.projectId, projectId))
      .orderBy(helenaSchedule.createdAt),
  ]);

  const byCard = new Map<number, Map<string, string>>();
  for (const field of fields) {
    const values = byCard.get(field.issueId) ?? new Map<string, string>();
    values.set(
      field.name.toLowerCase(),
      field.text ?? field.number ?? (field.bool == null ? '' : String(field.bool)),
    );
    byCard.set(field.issueId, values);
  }
  const inPeriod = (created: Date) => !start || created >= start;
  const fieldValue = (id: number, pattern: RegExp) =>
    [...(byCard.get(id)?.entries() ?? [])].find(([name]) => pattern.test(name))?.[1] ?? null;
  const signals = cards.filter(
    (card) => card.column.toLowerCase() === 'signal' && inPeriod(card.createdAt),
  );
  const vetos = cards.filter((card) => {
    if (!inPeriod(card.createdAt)) return false;
    if (
      /^(?:news|jev)[ -]?veto$/i.test(card.column) ||
      /^(?:news|jev)[ -]?veto$/i.test(card.type ?? '')
    )
      return true;
    const value = fieldValue(card.id, /(?:news|jev)[ -]?veto|veto[ -]?(?:news|jev)/i);
    return value != null && !/^(?:false|nein|no|0|)$/i.test(value.trim());
  });
  const results = cards
    .filter(
      (card) =>
        inPeriod(card.createdAt) &&
        /journal/i.test(`${card.column} ${card.type ?? ''} ${card.folder ?? ''}`),
    )
    .map((card) =>
      hypotheticalPercent(fieldValue(card.id, /hätte[ -]?ergebnis|haette[ -]?ergebnis/i)),
    )
    .filter((value): value is number => value != null);
  const watchlist = new Map<
    string,
    { symbol: string; rsi: number; direction: string; state: string; number: number }
  >();
  for (const card of cards) {
    if (!inPeriod(card.updatedAt)) continue;
    const indicators = fieldValue(card.id, /indikatoren/i);
    if (!indicators) continue;
    const rsi = rsiFromIndicators(indicators);
    const symbol = card.title.match(/\b[A-Z][A-Z0-9.]{0,5}\b/)?.[0];
    if (rsi == null || !symbol || watchlist.has(symbol)) continue;
    const direction = /↗|steigend|bullish|aufwärts/i.test(indicators)
      ? '↗'
      : /↘|fallend|bearish|abwärts/i.test(indicators)
        ? '↘'
        : '→';
    const state = vetos.some((veto) => veto.id === card.id)
      ? 'veto'
      : signals.some((signal) => signal.id === card.id)
        ? 'signal'
        : 'neutral';
    watchlist.set(symbol, { symbol, rsi, direction, state, number: card.number });
  }
  const scopedDecisions = decisions.filter((decision) => inPeriod(decision.createdAt));
  const fallbackId = setting[0]?.fallbackCredentialId;
  const scheduleIds = schedules.map((schedule) => schedule.id);
  const runs = scheduleIds.length
    ? await db
        .selectDistinctOn([pipelineRun.scheduleId], {
          scheduleId: pipelineRun.scheduleId,
          status: pipelineRun.status,
          createdAt: pipelineRun.createdAt,
          scheduledFor: pipelineRun.scheduledFor,
        })
        .from(pipelineRun)
        .where(inArray(pipelineRun.scheduleId, scheduleIds))
        .orderBy(
          pipelineRun.scheduleId,
          desc(pipelineRun.scheduledFor),
          desc(pipelineRun.createdAt),
        )
    : [];
  const bySchedule = new Map(runs.map((run) => [run.scheduleId, run]));
  return {
    signals: { count: signals.length, note: signals[0]?.title ?? null },
    vetos: { count: vetos.length, note: vetos[0]?.title ?? null },
    hypotheticalPercent: results.length ? results.reduce((sum, value) => sum + value, 0) : null,
    decisions: {
      total: scopedDecisions.length,
      safe: scopedDecisions.filter(
        (decision) => decision.status === 'decided' && decision.credentialId !== fallbackId,
      ).length,
      fallback: scopedDecisions.filter(
        (decision) => fallbackId != null && decision.credentialId === fallbackId,
      ).length,
    },
    watchlist: [...watchlist.values()]
      .sort((a, b) => a.number - b.number)
      .slice(0, 20)
      .map(({ symbol, rsi, direction, state }) => ({ symbol, rsi, direction, state })),
    schedules: schedules.map((schedule) => {
      const run = bySchedule.get(schedule.id);
      return {
        id: schedule.id,
        title: schedule.title,
        enabled: schedule.enabled,
        status: run?.status ?? null,
        lastRunAt: run ? (run.scheduledFor ?? run.createdAt).toISOString() : null,
        nextRunAt: schedule.enabled
          ? (nextFireTime(schedule.cron, schedule.timezone)?.toISOString() ?? null)
          : null,
      };
    }),
  };
}
