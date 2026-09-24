import {
  aiAgent,
  db,
  label,
  organizationAgentAssignment,
  projectMember,
  projectViewFolder,
  user,
} from '@repo/db';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { notHomeAgent } from '#modules/agents/core/home-agent';
import { listColumns } from '#modules/columns/service';
import { loadModelAvailability, runtimeOfPolicy } from '#modules/model-availability/service';
import {
  flattenSteps,
  type DefinitionIssue,
  type PipelineDefinition,
  type PipelineRole,
} from './definition';
import { findState } from '@helena/locales/defaults';

// What a workflow needs to know about the project it runs in: the agents that can fill
// its roles, and the names its steps use for statuses, labels, areas and members.

export interface ContextAgent {
  id: number;
  userId: string;
  username: string;
  name: string;
  role: string | null;
  capabilities: string[];
}

export interface ProjectContext {
  projectId: number;
  projectKey: string;
  agents: ContextAgent[];
  members: { id: string; name: string }[];
  statuses: { id: number; name: string; stateType: string }[];
  labels: { id: number; name: string }[];
  areas: { id: number; name: string }[];
  // The models the team's agents run, the only ones a step may run instead; a model the
  // provider refused this account is left out.
  models: string[];
  // The team's template agents by id, whose copies a template role finds.
  templates: { id: number; username: string; name: string }[];
}

export async function loadProjectContext(project: {
  id: number;
  key: string;
  teamId: number;
}): Promise<ProjectContext> {
  const [agents, members, statuses, labels, areas, teamAgents, availability] = await Promise.all([
    db
      .select({
        id: aiAgent.id,
        userId: aiAgent.userId,
        username: aiAgent.username,
        name: user.name,
        role: organizationAgentAssignment.role,
        capabilities: organizationAgentAssignment.capabilities,
      })
      .from(aiAgent)
      .innerJoin(user, eq(user.id, aiAgent.userId))
      .innerJoin(
        projectMember,
        and(eq(projectMember.userId, aiAgent.userId), eq(projectMember.projectId, project.id)),
      )
      .leftJoin(
        organizationAgentAssignment,
        and(
          eq(organizationAgentAssignment.agentId, aiAgent.id),
          eq(organizationAgentAssignment.teamId, aiAgent.teamId),
        ),
      )
      .where(and(eq(aiAgent.kind, 'external'), eq(aiAgent.template, false), notHomeAgent()))
      .orderBy(asc(aiAgent.username)),
    db
      .select({ id: user.id, name: user.name })
      .from(projectMember)
      .innerJoin(user, eq(user.id, projectMember.userId))
      .leftJoin(aiAgent, eq(aiAgent.userId, user.id))
      .where(and(eq(projectMember.projectId, project.id), isNull(aiAgent.id)))
      .orderBy(asc(user.name)),
    listColumns(project.id),
    db
      .select({ id: label.id, name: label.name })
      .from(label)
      .where(eq(label.projectId, project.id))
      .orderBy(asc(label.name)),
    db
      .select({ id: projectViewFolder.id, name: projectViewFolder.name })
      .from(projectViewFolder)
      .where(eq(projectViewFolder.projectId, project.id))
      .orderBy(asc(projectViewFolder.name)),
    db
      .select({
        id: aiAgent.id,
        username: aiAgent.username,
        name: user.name,
        model: aiAgent.model,
        template: aiAgent.template,
        runtimePolicy: aiAgent.runtimePolicy,
      })
      .from(aiAgent)
      .innerJoin(user, eq(user.id, aiAgent.userId))
      .where(eq(aiAgent.teamId, project.teamId)),
    loadModelAvailability(),
  ]);
  return {
    projectId: project.id,
    projectKey: project.key,
    agents: agents.map((agent) => ({ ...agent, capabilities: agent.capabilities ?? [] })),
    members,
    statuses: statuses.map((column) => ({
      id: column.id,
      name: column.name,
      stateType: column.stateType,
    })),
    labels,
    areas,
    models: [
      ...new Set(
        teamAgents
          .filter(
            (agent) =>
              !availability.refusal(runtimeOfPolicy(agent.runtimePolicy), agent.model?.trim()),
          )
          .map((agent) => agent.model?.trim())
          .filter((m): m is string => !!m),
      ),
    ].sort(),
    templates: teamAgents
      .filter((agent) => agent.template)
      .map(({ id, username, name }) => ({ id, username, name })),
  };
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// The username a copy of the template gets in the project (copyTemplateIntoProject).
function copyUsername(templateUsername: string, projectKey: string): string {
  const suffix = `-${projectKey.toLowerCase()}`;
  return templateUsername.slice(0, 64 - suffix.length) + suffix;
}

function only<T>(items: T[]): T | null {
  return items.length === 1 ? items[0] : null;
}

export interface ResolvedRole {
  key: string;
  name: string;
  agent: ContextAgent | null;
  // 'mapping' when the project names the agent, 'match' when the role's rule found it.
  source: 'mapping' | 'match' | null;
}

// The agent that fills each role in the project: the one the project names for it, or
// the only one the role's rule finds.
export function resolveRoles(
  roles: PipelineRole[],
  mapping: Record<string, number>,
  context: ProjectContext,
): ResolvedRole[] {
  return roles.map((role) => {
    const mapped = mapping[role.key];
    if (mapped !== undefined) {
      const agent = context.agents.find((candidate) => candidate.id === mapped) ?? null;
      return { key: role.key, name: role.name, agent, source: agent ? 'mapping' : null };
    }
    let agent: ContextAgent | null = null;
    const { match } = role;
    if (match.type === 'coordinator')
      agent = only(context.agents.filter((candidate) => candidate.role === 'coordinator'));
    else if (match.type === 'capability')
      agent = only(
        context.agents.filter((candidate) =>
          candidate.capabilities.some((capability) => same(capability, match.capability)),
        ),
      );
    else if (match.type === 'template') {
      const template = context.templates.find((candidate) => candidate.id === match.agentId);
      const username = template && copyUsername(template.username, context.projectKey);
      agent = context.agents.find((candidate) => candidate.username === username) ?? null;
    }
    return { key: role.key, name: role.name, agent, source: agent ? 'match' : null };
  });
}

// What stops the workflow from running in the project: roles no agent fills, agents and
// members outside it, and names of statuses, labels and areas it does not have.
export function projectIssues(
  definition: PipelineDefinition,
  mapping: Record<string, number>,
  context: ProjectContext,
): DefinitionIssue[] {
  const issues: DefinitionIssue[] = [];
  const resolved = new Map(
    resolveRoles(definition.roles, mapping, context).map((role) => [role.key, role]),
  );
  const usedRoles = new Map<string, string>();
  const status = (name: string) => findState(context.statuses, name) !== undefined;
  const hasLabel = (name: string) => context.labels.some((item) => same(item.name, name));
  const { trigger } = definition;
  if (trigger.type === 'status_changed' && trigger.to && !status(trigger.to))
    issues.push({
      code: 'unknown_status',
      stepId: null,
      field: 'trigger.to',
      params: { name: trigger.to },
    });
  if (trigger.type === 'label_added' && !hasLabel(trigger.label))
    issues.push({
      code: 'unknown_label',
      stepId: null,
      field: 'trigger.label',
      params: { name: trigger.label },
    });
  for (const { step } of flattenSteps(definition.steps)) {
    const add = (code: string, field: string, params?: DefinitionIssue['params']) =>
      issues.push({ code, stepId: step.id, field, ...(params ? { params } : {}) });
    if (step.type === 'agent') {
      if ('role' in step.assignee) usedRoles.set(step.assignee.role, step.id);
      else {
        const { agentId } = step.assignee;
        if (!context.agents.some((agent) => agent.id === agentId))
          add('agent_not_in_project', 'assignee');
      }
      if (step.model && !context.models.includes(step.model))
        add('model_not_allowed', 'model', { model: step.model });
    }
    if (step.type === 'condition' && step.condition.kind === 'task') {
      const { field, values } = step.condition;
      for (const value of values) {
        if (field === 'status' && !status(value))
          add('unknown_status', 'condition.values', { name: value });
        if (field === 'area' && !context.areas.some((area) => same(area.name, value)))
          add('unknown_area', 'condition.values', { name: value });
      }
    }
    if (step.type === 'action') {
      const { action } = step;
      if (action.kind === 'set_status' && !status(action.status))
        add('unknown_status', 'action.status', { name: action.status });
      if (action.kind === 'add_labels')
        for (const name of action.labels.filter((name) => !hasLabel(name)))
          add('unknown_label', 'action.labels', { name });
      if (action.kind === 'set_assignee' && action.assignee) {
        if ('role' in action.assignee) usedRoles.set(action.assignee.role, step.id);
        else {
          const { userId } = action.assignee;
          if (!context.members.some((member) => member.id === userId))
            add('member_not_in_project', 'action.assignee');
        }
      }
    }
  }
  for (const [key, stepId] of usedRoles) {
    const role = resolved.get(key);
    if (role && !role.agent)
      issues.push({
        code: 'role_unresolved',
        stepId,
        field: `roles.${key}`,
        params: { role: key },
      });
  }
  return issues;
}
