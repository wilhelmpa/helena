import type { ProjectBlueprint } from '@helena/sdk';
import { agentSkill, db, organizationAgentAssignment } from '@repo/db';
import { and, eq } from 'drizzle-orm';
import { VaultError } from '@repo/vault';
import { HttpError } from '#shared/lib';
import { copyTemplateIntoProject, getAgentById, updateAgent } from '#modules/agents/core/service';
import { setAgentSkills } from '#modules/agents/skills/service';
import { enableProjectBrowser } from '#modules/agents/mcp-servers/service';
import { createAgentTool, setAgentTools } from '#modules/agents/tools/service';
import { setAgentNetwork } from '#modules/agent-egress/service';
import { vaultScope } from '#modules/knowledge/scope';
import { writeNote } from '#modules/knowledge/service';
import { createBoardFile } from '#modules/note-boards/files';
import { createNoteBoard } from '#modules/note-boards/service';
import type { StickerCanvas } from '#modules/note-boards/canvas';
import {
  createGoal,
  setAgentAssignment,
  setAgentProjectInstructions,
  setProjectAssignment,
} from '#modules/organization/service';
import { createProject } from '#modules/projects/service';
import { createRoutine } from '#modules/routines/service';
import { createViewFolder } from '#modules/views/service';
import { describeChange, type BlueprintPlan, type BlueprintState, type Change } from './plan';
import { loadBlueprintState } from './state';

// Carries a blueprint plan out through the services Helena's own routes use, in the plan's
// order: the project first (its coordinator comes with it), then the areas, the agents,
// their network, the knowledge, goals, routines and tool bindings. The state is read again
// after a step that creates agents, so later steps find them by handle.

export interface ApplyContext {
  teamId: number;
  ownerUserId: string;
  blueprint: ProjectBlueprint;
  log: (line: string) => void;
}

function toStickers(change: Extract<Change, { kind: 'board' }>): StickerCanvas {
  return {
    nodes: change.stickers.map((sticker) => ({
      id: sticker.id,
      type: 'sticker',
      position: { x: sticker.x, y: sticker.y },
      width: sticker.width,
      height: sticker.height,
      data: { title: sticker.title, body: sticker.body, color: sticker.color ?? '#FFF9B1' },
    })),
    edges: change.edges.map((edge, index) => ({
      id: `e${index + 1}-${edge.from}-${edge.to}`,
      source: edge.from,
      target: edge.to,
    })),
  };
}

export async function applyBlueprintPlan(ctx: ApplyContext, plan: BlueprintPlan): Promise<number> {
  const { teamId, ownerUserId, blueprint, log } = ctx;
  const key = blueprint.project.key;
  let state: BlueprintState | null = null;
  const fresh = async () => (state ??= await loadBlueprintState(teamId, blueprint));
  const stale = () => {
    state = null;
  };
  const projectId = async () => {
    const current = await fresh();
    if (!current.project) throw new Error(`Project ${key} does not exist.`);
    return current.project.id;
  };
  const agent = async (handle: string) => {
    const current = await fresh();
    const found = current.agents.find(
      (entry) => entry.username.toLowerCase() === handle.toLowerCase(),
    );
    if (!found) throw new Error(`@${handle} does not exist.`);
    return found;
  };
  const skillIds = new Map(
    (
      await db
        .select({ id: agentSkill.id, name: agentSkill.name })
        .from(agentSkill)
        .where(eq(agentSkill.teamId, teamId))
    ).map((row) => [row.name, row.id]),
  );
  const scope = await vaultScope({ id: ownerUserId }, false);

  let done = 0;
  for (const change of plan.changes) {
    log(`[WRITE] ${describeChange(change)}`);
    switch (change.kind) {
      case 'project':
        await createProject(
          { key: change.key, name: change.name, description: change.description, locale: 'de' },
          ownerUserId,
          teamId,
        );
        stale();
        break;
      case 'projectDepartment':
        await setProjectAssignment(teamId, await projectId(), {
          departmentId: change.departmentId,
        });
        break;
      case 'projectInstructions':
        await setProjectAssignment(teamId, await projectId(), { instructions: change.to });
        break;
      case 'area':
        await createViewFolder(await projectId(), { name: change.name, folder: change.folder });
        break;
      case 'coordinatorInstructions': {
        const found = await agent(change.handle);
        await updateAgent(found.id, teamId, { instructions: change.to }, ownerUserId);
        break;
      }
      case 'copy': {
        const template = await getAgentById((await agent(change.template)).id, teamId);
        if (!template) throw new Error(`@${change.template} disappeared.`);
        const copied = await copyTemplateIntoProject(template, await projectId(), ownerUserId);
        if (copied.modelFallback) {
          log(
            `        @${change.handle}: the template's model ${copied.modelFallback.model} is refused ` +
              'for this account; the copy runs on the runtime default.',
          );
        }
        stale();
        break;
      }
      case 'skills': {
        const found = await agent(change.handle);
        const names = [...new Set([...found.skills, ...change.add])];
        await setAgentSkills(
          found.id,
          teamId,
          names.map((name) => skillIds.get(name)).filter((id): id is number => id !== undefined),
        );
        stale();
        break;
      }
      case 'assignment': {
        const found = await agent(change.handle);
        await setAgentProjectInstructions(teamId, found.id, await projectId(), change.to);
        break;
      }
      case 'department': {
        const found = await agent(change.handle);
        // The assignment is written whole, so everything but the department goes back as it is.
        const [current] = await db
          .select()
          .from(organizationAgentAssignment)
          .where(
            and(
              eq(organizationAgentAssignment.teamId, teamId),
              eq(organizationAgentAssignment.agentId, found.id),
            ),
          );
        await setAgentAssignment(teamId, found.id, {
          departmentId: change.departmentId,
          reportsToAgentId: current?.reportsToAgentId ?? null,
          roleTitle: current?.roleTitle ?? '',
          runtimeAgentId: current?.runtimeAgentId ?? null,
        });
        break;
      }
      case 'projectBrowser':
        await enableProjectBrowser(teamId, (await agent(change.handle)).id);
        break;
      case 'memoryApprovalOff': {
        const found = await agent(change.handle);
        const full = await getAgentById(found.id, teamId);
        if (!full) throw new Error(`@${change.handle} disappeared.`);
        await updateAgent(
          found.id,
          teamId,
          { runtimePolicy: { ...full.runtimePolicy, memoryApproval: false } },
          ownerUserId,
        );
        stale();
        break;
      }
      case 'network': {
        const current = await fresh();
        const id = await projectId();
        const agents: Record<string, 'open' | 'allowlist' | 'blocked'> = {};
        for (const [handle, mode] of Object.entries(change.agents)) {
          agents[String((await agent(handle)).id)] = mode;
        }
        await setAgentNetwork(id, ownerUserId, {
          ...(change.mode ? { mode: change.mode } : {}),
          allow: [...(current.network?.allow ?? []), ...change.addAllow],
          deny: [...(current.network?.deny ?? []), ...change.addDeny],
          agents,
        });
        break;
      }
      case 'file':
        try {
          await writeNote(scope, { path: change.path, content: change.content });
        } catch (error) {
          const exists =
            (error instanceof VaultError && error.code === 'exists') ||
            (error instanceof HttpError && error.status === 409);
          if (!exists) throw error;
          log(`        ${change.path} exists meanwhile; left as it is`);
        }
        break;
      case 'board': {
        const id = await projectId();
        const stickers = toStickers(change);
        const file = await createBoardFile(key, change.name, stickers, {
          ref: `user:${ownerUserId}`,
        });
        await createNoteBoard({
          projectId: id,
          ownerUserId: null,
          createdByUserId: ownerUserId,
          name: change.name,
          ...file,
        });
        break;
      }
      case 'goal':
        await createGoal(teamId, {
          title: change.title,
          description: change.description,
          status: change.status,
          targetDate: change.targetDate,
          departmentId: change.departmentId,
          projectId: await projectId(),
        });
        break;
      case 'routine': {
        const current = await fresh();
        if (!current.project) throw new Error(`Project ${key} does not exist.`);
        await createRoutine(
          { id: current.project.id, key, name: current.project.name, teamId },
          ownerUserId,
          {
            idempotencyKey: change.idempotencyKey,
            agentId: (await agent(change.handle)).id,
            title: change.title,
            instructions: change.instructions,
            mode: 'new',
            cron: change.cron,
            timezone: change.timezone,
            catchUp: change.catchUp,
            enabled: false,
          },
        );
        break;
      }
      case 'tools': {
        const found = await agent(change.handle);
        const current = await fresh();
        const ids = found.tools.map((tool) => tool.agentToolId);
        for (const toolKey of change.toolKeys) {
          const existing = current.agentTools.find(
            (tool) => tool.toolKey === toolKey && tool.credentialId === change.credentialId,
          );
          const id =
            existing?.id ??
            (await createAgentTool(teamId, { toolKey, credentialId: change.credentialId })).id;
          ids.push(id);
        }
        await setAgentTools(found.id, teamId, ids);
        stale();
        break;
      }
    }
    done += 1;
  }
  return done;
}
