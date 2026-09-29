'use client';

import type { OrganizationAgent, OrganizationProject } from '@/lib/api/endpoints/organization';
import OrganizationOrchestrationBudget from './OrganizationOrchestrationBudget';
import OrganizationOrchestrationFlow from './OrganizationOrchestrationFlow';
import OrganizationOrchestrationPolicy from './OrganizationOrchestrationPolicy';
import OrganizationOrchestrationTeam from './OrganizationOrchestrationTeam';
import OrganizationOrchestrationUsage from './OrganizationOrchestrationUsage';
import { Stack } from '@/design-system';

// How the project's agents work together: who has which team role, the tokens they
// use and may spend, whether the agent-team workflow runs and with which limits, and the
// paths a task takes.
export default function OrganizationOrchestration({
  teamId,
  project,
  agents,
  projectKey,
}: {
  teamId: number;
  project: OrganizationProject | undefined;
  agents: OrganizationAgent[];
  projectKey: string;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <OrganizationOrchestrationTeam agents={agents} />
      <Stack gap={4}>
        <OrganizationOrchestrationUsage projectKey={projectKey} />
        {project && (
          <OrganizationOrchestrationBudget teamId={teamId} project={project} agents={agents} />
        )}
        <OrganizationOrchestrationPolicy projectKey={projectKey} agents={agents} />
        <OrganizationOrchestrationFlow />
      </Stack>
    </div>
  );
}
