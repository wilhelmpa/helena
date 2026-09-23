'use client';

import type { OrganizationAgent } from '@/lib/api/endpoints/organization';
import OrganizationOrchestrationFlow from './OrganizationOrchestrationFlow';
import OrganizationOrchestrationPolicy from './OrganizationOrchestrationPolicy';
import OrganizationOrchestrationTeam from './OrganizationOrchestrationTeam';
import OrganizationOrchestrationUsage from './OrganizationOrchestrationUsage';

// How the project's agents work together: who has which team role, the tokens they
// use, whether the agent-team workflow runs and with which limits, and the paths a task
// takes.
export default function OrganizationOrchestration({
  agents,
  projectKey,
}: {
  agents: OrganizationAgent[];
  projectKey: string;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <OrganizationOrchestrationTeam agents={agents} />
      <div className="space-y-4">
        <OrganizationOrchestrationUsage projectKey={projectKey} />
        <OrganizationOrchestrationPolicy projectKey={projectKey} agents={agents} />
        <OrganizationOrchestrationFlow />
      </div>
    </div>
  );
}
