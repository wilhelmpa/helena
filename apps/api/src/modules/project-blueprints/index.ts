import { resolve } from 'node:path';
import { Elysia, t } from 'elysia';
import { aiAgent, db, team, teamMember } from '@repo/db';
import { and, eq } from 'drizzle-orm';
import { authContext } from '#shared/auth-context';
import { requireUser } from '#shared/access';
import { HttpError } from '#shared/lib';
import { mcpTool } from '#mcp/generate';
import { oneOf } from '#shared/schemas';
import { runProjectBlueprint } from '../../scripts/project-blueprint';
import { BLUEPRINT_SECTIONS } from './plan';

const blueprintNames = ['family', 'personal-elli', 'personal-priv', 'trading'] as const;
const BlueprintBody = t.Object({
  blueprint: oneOf(blueprintNames),
  teamId: t.Optional(t.Integer({ minimum: 1 })),
  sections: t.Optional(t.Array(oneOf(BLUEPRINT_SECTIONS), { minItems: 1, uniqueItems: true })),
});

async function blueprintTeamFor(userId: string, requested?: number): Promise<number> {
  const [agent] = await db
    .select({ teamId: aiAgent.teamId, role: aiAgent.agentRole, mcpEnabled: team.mcpEnabled })
    .from(aiAgent)
    .innerJoin(team, eq(team.id, aiAgent.teamId))
    .where(eq(aiAgent.userId, userId))
    .limit(1);
  if (agent) {
    if (agent.role !== 'home' || !agent.mcpEnabled || (requested && requested !== agent.teamId))
      throw new HttpError(403, 'Only Home may apply a team blueprint');
    return agent.teamId;
  }
  const [owner] = await db
    .select({ teamId: teamMember.teamId })
    .from(teamMember)
    .where(
      and(
        eq(teamMember.userId, userId),
        eq(teamMember.role, 'owner'),
        requested ? eq(teamMember.teamId, requested) : undefined,
      ),
    )
    .orderBy(teamMember.teamId)
    .limit(1);
  if (!owner) throw new HttpError(403, 'A team owner is required');
  return owner.teamId;
}

async function runBlueprint(userId: string, body: typeof BlueprintBody.static, apply: boolean) {
  const teamId = await blueprintTeamFor(userId, body.teamId);
  const lines: string[] = [];
  const plan = await runProjectBlueprint({
    blueprint: resolve(import.meta.dir, '../../../../../blueprints', body.blueprint),
    teamId,
    apply,
    sections: body.sections,
    log: (line) => lines.push(line),
  });
  return { teamId, blueprint: body.blueprint, applied: apply, plan, lines };
}

export const projectBlueprintRoutes = new Elysia({ name: 'project-blueprints' })
  .use(authContext)
  .post(
    '/project-blueprints/preview',
    ({ user, body }) => runBlueprint(requireUser(user).id, body, false),
    {
      body: BlueprintBody,
      detail: {
        summary: 'Preview a project blueprint',
        description: 'Dry run a bundled project blueprint for the Home team or a team you own.',
        ...mcpTool(
          'preview_project_blueprint',
          { readOnlyHint: true, idempotentHint: true },
          'read',
        ),
      },
    },
  )
  .post(
    '/project-blueprints/apply',
    ({ user, body }) => runBlueprint(requireUser(user).id, body, true),
    {
      body: BlueprintBody,
      detail: {
        summary: 'Apply a project blueprint',
        description: 'Create the project and missing resources from a bundled blueprint.',
        ...mcpTool('apply_project_blueprint', undefined, 'write'),
      },
    },
  );
