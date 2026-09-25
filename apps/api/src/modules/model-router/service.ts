import { aiAgent, db, helenaModelRoute, helenaModelRouterSetting, project, user } from '@repo/db';
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { HttpError, iso } from '#shared/lib';
import { readChatCatalog } from '#modules/agents/chat/service';
import { price } from '#modules/model-prices/service';
import { ROUTER_CLASS } from '#modules/decisions/classes';
import { routerQuestions, type RouterTier } from '#modules/decisions/questions';
import { classSetting, decide } from '#modules/decisions/service';
import { useClassConfigChecker } from '#modules/decisions/settings';
import { chooseModel, thinkingFor, type RouterModel } from './tiers';

// The model router (docs/helena-decisions/decisions.md §4): before a run or a chat answer, a
// decision model rates how hard the request is and whether it depends on the earlier
// conversation; when a cheaper model of the same runtime covers it, is confident enough, and
// the request stands on its own, the run or answer uses that model. Off by default: per agent
// (switch) and per project (on unless switched off), and the class "Modellwahl" must be on
// (which needs its eval). Never above the configured model unless the owner allowed an
// upgrade for the agent. Every evaluation is recorded (from → to, and why), visible in the
// run and the chat.

const CONTEXT_THRESHOLD = 0.5;

export interface RouterConfig {
  // P(depends on the earlier conversation) from which the configured model stays.
  contextThreshold: number;
}

export function routerConfig(config: Record<string, unknown>): RouterConfig {
  const value = Number(config.contextThreshold);
  return {
    contextThreshold: Number.isFinite(value) && value > 0 && value <= 1 ? value : CONTEXT_THRESHOLD,
  };
}

useClassConfigChecker(ROUTER_CLASS, async (config) => {
  const value = config.contextThreshold;
  if (value !== undefined && (typeof value !== 'number' || !(value > 0 && value <= 1)))
    throw new HttpError(400, 'contextThreshold must be a number above 0 and at most 1.');
  return value === undefined ? {} : { contextThreshold: value };
});

export interface RouterSwitch {
  enabled: boolean;
  allowUpgrade: boolean;
}

// The agent's switch (off unless set) and the project's (on unless switched off).
export async function routerSwitches(
  agentId: number,
  projectId: number | null,
): Promise<{ agent: RouterSwitch; projectAllows: boolean }> {
  const rows = await db
    .select()
    .from(helenaModelRouterSetting)
    .where(
      projectId === null
        ? eq(helenaModelRouterSetting.agentId, agentId)
        : sql`${helenaModelRouterSetting.agentId} = ${agentId} OR ${helenaModelRouterSetting.projectId} = ${projectId}`,
    );
  const agent = rows.find((row) => row.agentId === agentId);
  const forProject = projectId === null ? null : rows.find((row) => row.projectId === projectId);
  return {
    agent: { enabled: agent?.enabled ?? false, allowUpgrade: agent?.allowUpgrade ?? false },
    projectAllows: forProject ? forProject.enabled : true,
  };
}

export async function setAgentRouter(
  teamId: number,
  agentId: number,
  input: Partial<RouterSwitch>,
  userId: string | null,
): Promise<RouterSwitch> {
  const [agent] = await db
    .select({ id: aiAgent.id })
    .from(aiAgent)
    .where(and(eq(aiAgent.id, agentId), eq(aiAgent.teamId, teamId)));
  if (!agent) throw new HttpError(404, 'Agent not found');
  const current = (await routerSwitches(agentId, null)).agent;
  const next = {
    enabled: input.enabled ?? current.enabled,
    allowUpgrade: input.allowUpgrade ?? current.allowUpgrade,
  };
  await db
    .insert(helenaModelRouterSetting)
    .values({ teamId, agentId, ...next, updatedByUserId: userId })
    .onConflictDoUpdate({
      target: helenaModelRouterSetting.agentId,
      targetWhere: isNotNull(helenaModelRouterSetting.agentId),
      set: { ...next, updatedByUserId: userId, updatedAt: new Date() },
    });
  return next;
}

export async function setProjectRouter(
  teamId: number,
  projectId: number,
  enabled: boolean,
  userId: string | null,
): Promise<{ enabled: boolean }> {
  await db
    .insert(helenaModelRouterSetting)
    .values({ teamId, projectId, enabled, updatedByUserId: userId })
    .onConflictDoUpdate({
      target: helenaModelRouterSetting.projectId,
      targetWhere: isNotNull(helenaModelRouterSetting.projectId),
      set: { enabled, updatedByUserId: userId, updatedAt: new Date() },
    });
  return { enabled };
}

export interface RouterOverview {
  agents: {
    id: number;
    name: string;
    model: string | null;
    enabled: boolean;
    allowUpgrade: boolean;
  }[];
  projects: { id: number; key: string; name: string; enabled: boolean }[];
  recent: RouteView[];
}

export async function routerOverview(teamId: number): Promise<RouterOverview> {
  const [agents, projects, settings, recent] = await Promise.all([
    db
      .select({ id: aiAgent.id, name: user.name, model: aiAgent.model })
      .from(aiAgent)
      .innerJoin(user, eq(user.id, aiAgent.userId))
      .where(and(eq(aiAgent.teamId, teamId), eq(aiAgent.template, false)))
      .orderBy(user.name),
    db
      .select({ id: project.id, key: project.key, name: project.name })
      .from(project)
      .where(eq(project.teamId, teamId))
      .orderBy(project.name),
    db.select().from(helenaModelRouterSetting).where(eq(helenaModelRouterSetting.teamId, teamId)),
    db
      .select()
      .from(helenaModelRoute)
      .where(eq(helenaModelRoute.teamId, teamId))
      .orderBy(desc(helenaModelRoute.id))
      .limit(30),
  ]);
  return {
    agents: agents.map((agent) => {
      const row = settings.find((setting) => setting.agentId === agent.id);
      return {
        ...agent,
        enabled: row?.enabled ?? false,
        allowUpgrade: row?.allowUpgrade ?? false,
      };
    }),
    projects: projects.map((entry) => ({
      ...entry,
      enabled: settings.find((setting) => setting.projectId === entry.id)?.enabled ?? true,
    })),
    recent: recent.map(routeView),
  };
}

export interface RouteView {
  id: number;
  agentId: number;
  runId: number | null;
  chatMessageId: number | null;
  fromModel: string;
  toModel: string;
  routed: boolean;
  tier: string | null;
  confidence: number | null;
  needsContext: number | null;
  reason: string;
  createdAt: string;
}

export function routeView(row: typeof helenaModelRoute.$inferSelect): RouteView {
  return {
    id: row.id,
    agentId: row.agentId,
    runId: row.runId,
    chatMessageId: row.chatMessageId,
    fromModel: row.fromModel,
    toModel: row.toModel,
    routed: row.routed,
    tier: row.tier,
    confidence: row.confidence,
    needsContext: row.needsContext,
    reason: row.reason,
    createdAt: iso(row.createdAt),
  };
}

// The routes of runs and chat answers, for their views.
export async function routesOfRuns(runIds: number[]): Promise<Map<number, RouteView>> {
  if (runIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(helenaModelRoute)
    .where(inArray(helenaModelRoute.runId, runIds));
  return new Map(rows.map((row) => [row.runId!, routeView(row)]));
}

export async function routesOfChatMessages(ids: number[]): Promise<Map<number, RouteView>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select()
    .from(helenaModelRoute)
    .where(inArray(helenaModelRoute.chatMessageId, ids));
  return new Map(rows.map((row) => [row.chatMessageId!, routeView(row)]));
}

export interface RouteRequest {
  teamId: number;
  agentId: number;
  projectId: number | null;
  configuredModel: string | null;
  thinkingLevel: string | null;
  // The request as the agent will read it: a task, a chat question.
  text: string;
  runId?: number;
  chatMessageId?: number;
}

export interface RouteResult {
  model: string | null;
  thinkingLevel: string | null;
  route: RouteView | null;
}

async function catalogOf(agentId: number): Promise<RouterModel[]> {
  const catalog = await readChatCatalog(agentId);
  return Promise.all(
    catalog.models.map(async (model) => ({
      id: model.id,
      provider: model.provider,
      inputPrice: (await price(model.id, model.provider))?.inputPerMTok ?? null,
      thinkingLevels: model.thinkingLevels,
      thinkingDefault: model.thinkingDefault,
    })),
  );
}

// Decides the model of one run or chat answer. Never throws: on any failure the configured
// model stays.
export async function routeRequest(request: RouteRequest): Promise<RouteResult> {
  const unchanged: RouteResult = {
    model: request.configuredModel,
    thinkingLevel: request.thinkingLevel,
    route: null,
  };
  try {
    // A claim handed out again (a retry) keeps the model it was routed to the first time.
    const [earlier] =
      request.runId || request.chatMessageId
        ? await db
            .select()
            .from(helenaModelRoute)
            .where(
              request.runId
                ? eq(helenaModelRoute.runId, request.runId)
                : eq(helenaModelRoute.chatMessageId, request.chatMessageId!),
            )
        : [];
    if (earlier) {
      return {
        model: earlier.toModel,
        thinkingLevel: earlier.routed ? null : request.thinkingLevel,
        route: routeView(earlier),
      };
    }
    const switches = await routerSwitches(request.agentId, request.projectId);
    if (!switches.agent.enabled || !switches.projectAllows || !request.configuredModel)
      return unchanged;
    const catalog = await catalogOf(request.agentId);
    const configured: RouterModel = catalog.find(
      (model) => model.id === request.configuredModel,
    ) ?? {
      id: request.configuredModel,
      inputPrice: (await price(request.configuredModel))?.inputPerMTok ?? null,
    };
    const outcome = await decide({
      teamId: request.teamId,
      classId: ROUTER_CLASS,
      context: request.text.slice(0, 8000),
      questions: routerQuestions(),
      subject: request.runId ? `run:${request.runId}` : `chat:${request.chatMessageId}`,
      projectId: request.projectId,
      agentId: request.agentId,
      runId: request.runId ?? null,
      chatMessageId: request.chatMessageId ?? null,
    });
    if (outcome.status === 'off') return unchanged;
    const route = outcome.answers.route;
    const needs = outcome.answers.needs_context;
    const needsContext = needs?.probabilities?.yes ?? null;
    let target = configured;
    let reason: string = outcome.status;
    if (route?.choice && needs?.choice) {
      const { contextThreshold } = routerConfig(
        (await classSetting(request.teamId, ROUTER_CLASS)).config,
      );
      if (!route.decided) reason = 'unsure';
      else if ((needsContext ?? 1) >= contextThreshold) reason = 'needs_context';
      else {
        const choice = chooseModel(
          configured,
          catalog,
          route.choice as RouterTier,
          switches.agent.allowUpgrade,
        );
        target = choice.model;
        reason = choice.reason;
      }
    }
    const [row] = await db
      .insert(helenaModelRoute)
      .values({
        teamId: request.teamId,
        agentId: request.agentId,
        projectId: request.projectId,
        runId: request.runId ?? null,
        chatMessageId: request.chatMessageId ?? null,
        fromModel: configured.id,
        toModel: target.id,
        routed: target.id !== configured.id,
        tier: route?.choice ?? null,
        confidence: route?.confidence ?? null,
        needsContext,
        reason,
        decisionId: route?.decisionId ?? null,
      })
      .onConflictDoNothing()
      .returning();
    return {
      model: target.id,
      thinkingLevel:
        target.id === configured.id
          ? request.thinkingLevel
          : thinkingFor(target, request.thinkingLevel),
      route: row ? routeView(row) : null,
    };
  } catch (error) {
    console.error('[model-router] routing failed, the configured model stays', error);
    return unchanged;
  }
}
