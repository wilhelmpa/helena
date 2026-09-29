'use client';

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { getProjectAutopilot, type BudgetStatus } from '@/lib/api/endpoints/autopilot';
import { useProjectsQuery } from '@/services/projects.service';
import { useTeamsQuery } from '@/services/teams.service';
import { qk } from '@/services/queryKeys';
import { useOrganizationQuery } from '@/features/organization/services/organization.service';
import { soleTeamId } from '@/utils/homeTeamScope';
import { budgetAlerts, type BudgetAlert, type BudgetHolder } from './budgetAlerts';

export interface BudgetOverview {
  // The budgets of each project (by key), as its settings show them.
  byProject: Map<string, BudgetStatus[]>;
  // What slows or stops work now: the projects', the agents' and the departments'.
  alerts: BudgetAlert[];
  // Whether any budget is set at all.
  any: boolean;
  teamId: number | null;
  isPending: boolean;
}

// The budgets across Helena for Start (tile, project cards, "Braucht dich"): one read of the
// team's organization (agents and departments with their budgets) and each project's
// Autopilot (its budgets), the same reads its settings use.
export function useBudgetOverview(enabled = true): BudgetOverview {
  const projects = (useProjectsQuery().data ?? []).filter(
    (project) => project.projectRole !== 'home',
  );
  const teamId = soleTeamId(useTeamsQuery().data);
  const organization = useOrganizationQuery(enabled ? teamId : null);
  const autopilots = useQueries({
    queries: projects.map((project) => ({
      queryKey: qk.projectAutopilot(project.key),
      queryFn: () => getProjectAutopilot(project.key),
      enabled,
      staleTime: 60_000,
    })),
  });
  const budgetsKey = autopilots.map((query) => query.dataUpdatedAt).join(',');
  const projectKeys = projects.map((project) => project.key).join(',');
  return useMemo(() => {
    const byProject = new Map<string, BudgetStatus[]>();
    projects.forEach((project, index) => {
      const budgets = autopilots[index]?.data?.budgets;
      if (budgets) byProject.set(project.key, budgets);
    });
    const holders: BudgetHolder[] = [
      ...projects.map((project) => ({
        scope: 'project' as const,
        id: project.id,
        name: project.name,
        projectKey: project.key,
        budgets: byProject.get(project.key),
      })),
      ...(organization.data?.agents ?? [])
        .filter((agent) => !agent.template)
        .map((agent) => ({
          scope: 'agent' as const,
          id: agent.id,
          name: agent.name,
          budgets: agent.budgets,
        })),
      ...(organization.data?.departments ?? []).map((department) => ({
        scope: 'department' as const,
        id: department.id,
        name: department.name,
        budgets: department.budgets,
      })),
    ];
    return {
      byProject,
      alerts: budgetAlerts(holders),
      any: holders.some((holder) => (holder.budgets?.length ?? 0) > 0),
      teamId,
      isPending: organization.isPending || autopilots.some((query) => query.isPending),
    };
    // The queries' data is keyed by their update times (budgetsKey).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [budgetsKey, organization.data, organization.isPending, teamId, projectKeys]);
}
