import {
  db,
  pipelineRun,
  projectWorkflowAssignment,
  type ProjectWorkflowConfiguration,
} from '@repo/db';
import { and, asc, count, eq } from 'drizzle-orm';
import { HttpError, iso } from '#shared/lib';
import { bumpControlPlaneRevision } from '#modules/sync/service';
import { runDtos } from '#modules/pipelines/runs';

// The built-in workflows a project switches on in Settings → Workflows and the Helena
// engine runs: today the agent team, which works on a task delegated to a coordinator.
// Their settings live in project_workflow_assignment, their runs in pipeline_run like
// every run of the engine.

export const AGENT_TEAM = 'agent-team';

interface ProjectContext {
  id: number;
  key: string;
  teamId: number;
}

interface CatalogEntry {
  id: string;
  name: string;
  description: string;
  capabilityRefs: string[];
  externalEffects: boolean;
  triggers: string[];
  steps: { id: string; title: string; description: string }[];
}

// What the settings page shows of a built-in workflow.
export const CATALOG: CatalogEntry[] = [
  {
    id: AGENT_TEAM,
    name: 'Project agent team',
    description:
      'The coordinator plans a delegated task, specialists do the work in dependency order, the coordinator reviews it, and the result goes to the task.',
    capabilityRefs: [],
    externalEffects: false,
    triggers: ['delegation'],
    steps: [
      {
        id: 'coordinate',
        title: 'Create delegations',
        description:
          'Route the task to the one specialist whose capabilities fit, or ask the coordinator for assignments with dependencies.',
      },
      {
        id: 'specialize',
        title: 'Execute specialist work',
        description:
          'Run the assignments in dependency order, independent ones in parallel, each as an agent run with its limits.',
      },
      {
        id: 'review',
        title: 'Review evidence',
        description:
          'The coordinator checks the evidence against every acceptance criterion when the project asks for a review.',
      },
      {
        id: 'synchronize',
        title: 'Update the task',
        description:
          'Write the summary and the evidence to the task and move it to Review, or to Done when the project allows it.',
      },
    ],
  },
];

// The agent-team settings with their defaults: the coordinator reviews the work, the
// task stays in Review for a person, and Hermes keeps its own turn and time limits.
export function agentTeamConfiguration(configuration: ProjectWorkflowConfiguration) {
  return {
    ...configuration,
    autonomy: configuration.autonomy ?? 'review',
    reviewRequired: configuration.reviewRequired ?? true,
    maxTurns: configuration.maxTurns ?? null,
    runBudgetSeconds: configuration.runBudgetSeconds ?? null,
  };
}

// The policy of an agent-team run under the project's settings.
export function agentTeamPolicy(configuration: ProjectWorkflowConfiguration) {
  const settings = agentTeamConfiguration(configuration);
  return {
    reviewRequired: settings.reviewRequired,
    autonomy: settings.autonomy,
    ...(settings.maxTurns ? { maxTurns: settings.maxTurns } : {}),
    ...(settings.runBudgetSeconds ? { runBudgetSeconds: settings.runBudgetSeconds } : {}),
  };
}

function catalogEntry(workflowId: string) {
  const flow = CATALOG.find((item) => item.id === workflowId);
  if (!flow) throw new HttpError(404, 'Workflow not found');
  return flow;
}

export async function assignment(projectId: number, workflowId: string) {
  const [row] = await db
    .select()
    .from(projectWorkflowAssignment)
    .where(
      and(
        eq(projectWorkflowAssignment.projectId, projectId),
        eq(projectWorkflowAssignment.workflowId, workflowId),
      ),
    );
  return row ?? null;
}

export async function listProjectWorkflows(projectId: number) {
  const assignments = await db
    .select()
    .from(projectWorkflowAssignment)
    .where(eq(projectWorkflowAssignment.projectId, projectId))
    .orderBy(asc(projectWorkflowAssignment.workflowId));
  const assigned = new Map(assignments.map((row) => [row.workflowId, row]));
  return CATALOG.map((flow) => {
    const row = assigned.get(flow.id);
    return {
      ...flow,
      assignment: row
        ? {
            enabled: row.enabled,
            capabilityRefs: row.capabilityRefs,
            configuration: agentTeamConfiguration(row.configuration),
            createdAt: iso(row.createdAt),
            updatedAt: iso(row.updatedAt),
          }
        : {
            enabled: false,
            capabilityRefs: [],
            configuration: agentTeamConfiguration({}),
          },
    };
  });
}

export async function setProjectWorkflowAssignment(input: {
  projectId: number;
  workflowId: string;
  enabled: boolean;
  capabilityRefs: string[];
  configuration?: ProjectWorkflowConfiguration;
  createdBy: string;
}) {
  catalogEntry(input.workflowId);
  const settings = agentTeamConfiguration(input.configuration ?? {});
  if (settings.autonomy === 'done' && !settings.reviewRequired)
    throw new HttpError(400, 'Autonomy done requires the coordinator review');
  if (input.capabilityRefs.length > 0)
    throw new HttpError(400, 'The project does not grant a capability required by this workflow');
  const [row] = await db
    .insert(projectWorkflowAssignment)
    .values({
      projectId: input.projectId,
      workflowId: input.workflowId,
      enabled: input.enabled,
      capabilityRefs: [],
      configuration: input.configuration ?? {},
      createdBy: input.createdBy,
    })
    .onConflictDoUpdate({
      target: [projectWorkflowAssignment.projectId, projectWorkflowAssignment.workflowId],
      set: {
        enabled: input.enabled,
        configuration: input.configuration ?? {},
        updatedAt: new Date(),
      },
    })
    .returning();
  await bumpControlPlaneRevision(input.projectId);
  return row;
}

export async function isWorkflowEnabled(projectId: number, workflowId: string) {
  return (await assignment(projectId, workflowId))?.enabled === true;
}

// The runs of a built-in workflow in the project, newest first.
export async function listWorkflowRuns(
  project: ProjectContext,
  workflowId: string,
  window: { limit: number; offset: number },
) {
  catalogEntry(workflowId);
  const where = and(eq(pipelineRun.projectId, project.id), eq(pipelineRun.kind, 'agent_team'));
  const [items, [total]] = await Promise.all([
    runDtos(where, window),
    db.select({ value: count() }).from(pipelineRun).where(where),
  ]);
  return { items, total: total?.value ?? 0 };
}

export async function getWorkflowRun(project: ProjectContext, workflowId: string, runId: string) {
  catalogEntry(workflowId);
  const [run] = await runDtos(
    and(
      eq(pipelineRun.id, runId),
      eq(pipelineRun.projectId, project.id),
      eq(pipelineRun.kind, 'agent_team'),
    ),
  );
  if (!run) throw new HttpError(404, 'Workflow run not found');
  return run;
}
