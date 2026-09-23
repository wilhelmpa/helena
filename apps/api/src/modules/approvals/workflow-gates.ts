import { db, projectWorkflowAssignment } from '@repo/db';
import { and, eq, inArray } from 'drizzle-orm';
import {
  catalogFlows,
  controlPlaneRequest,
  projectWorkflowScope,
} from '#modules/control-plane-workflows/service';
import { projectsWithPermission } from './service';

// The Mastra workflow runs suspended at their approval gate, in the projects where the
// user may decide them: the permission the decision route asserts.

export interface WorkflowGate {
  projectId: number;
  projectKey: string;
  projectName: string;
  workflowId: string;
  workflowName: string;
  runId: string;
  reason: string | null;
  summary: string | null;
  effects: string[];
  createdAt: string | null;
}

// A listing waits this long per request: the page must not hang on a slow control plane.
const LIST_TIMEOUT_MS = 10_000;

// The control plane lists runs newest first and at most 100 per request, so a gate older
// than the newest 100 runs of its workflow in the project is not listed.
const RUNS_READ = 100;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

// Mastra stores each step's result under its id in the run's context: the gate's
// suspend payload says why it waits, the prepared plan lists the effects it holds back.
function gateOf(
  value: unknown,
): Pick<WorkflowGate, 'runId' | 'reason' | 'summary' | 'effects' | 'createdAt'> | null {
  const run = record(value);
  const snapshot = record(run.snapshot);
  if ((run.status ?? snapshot.status) !== 'suspended') return null;
  const context = record(snapshot.context);
  const prepared = record(record(context['prepare-plan']).output);
  const effects = Array.isArray(prepared.effects) ? prepared.effects.map(record) : [];
  return {
    runId: String(run.runId),
    reason: text(record(record(context['approval-gate']).suspendPayload).reason),
    summary: text(prepared.summary),
    effects: effects
      .filter((effect) => effect.requiresApproval === true)
      .map((effect) => text(effect.description))
      .filter((description): description is string => description != null),
    createdAt: text(run.createdAt),
  };
}

export async function listWorkflowGates(
  userId: string,
): Promise<{ items: WorkflowGate[]; complete: boolean }> {
  const projects = await projectsWithPermission(userId, ['actions', 'edit']);
  if (projects.length === 0) return { items: [], complete: true };
  const assignments = await db
    .select({
      projectId: projectWorkflowAssignment.projectId,
      workflowId: projectWorkflowAssignment.workflowId,
    })
    .from(projectWorkflowAssignment)
    .where(
      and(
        inArray(
          projectWorkflowAssignment.projectId,
          projects.map((p) => p.id),
        ),
        eq(projectWorkflowAssignment.enabled, true),
      ),
    );
  if (assignments.length === 0) return { items: [], complete: true };

  let names: Map<string, string>;
  try {
    // Only a workflow with external effects has an approval gate to suspend at.
    names = new Map(
      (await catalogFlows())
        .filter((flow) => flow.externalEffects === true)
        .map((flow) => [flow.id, text(flow.name) ?? flow.id]),
    );
  } catch {
    return { items: [], complete: false };
  }

  const byId = new Map(projects.map((p) => [p.id, p]));
  let complete = true;
  const lists = await Promise.all(
    assignments
      .filter((row) => names.has(row.workflowId))
      .map(async (row) => {
        const project = byId.get(row.projectId)!;
        try {
          const result = await controlPlaneRequest<{ runs?: unknown[] }>(
            {
              operation: 'runs',
              workflowId: row.workflowId,
              projectRef: projectWorkflowScope(project).projectRef,
              page: 0,
              pageSize: RUNS_READ,
            },
            LIST_TIMEOUT_MS,
          );
          return (result.runs ?? []).flatMap((run) => {
            const gate = gateOf(run);
            return gate
              ? [
                  {
                    ...gate,
                    projectId: project.id,
                    projectKey: project.key,
                    projectName: project.name,
                    workflowId: row.workflowId,
                    workflowName: names.get(row.workflowId)!,
                  },
                ]
              : [];
          });
        } catch {
          complete = false;
          return [];
        }
      }),
  );
  const items = lists.flat().sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  return { items, complete };
}
