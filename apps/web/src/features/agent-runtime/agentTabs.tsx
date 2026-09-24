'use client';

import type { ComponentType } from 'react';
import { Brain, Gauge, MessagesSquare, Server, Waypoints } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import AgentMemoryPanel from './components/AgentMemoryPanel';
import AgentRunsPanel from './components/AgentRunsPanel';
import AgentRuntimePanel from './components/AgentRuntimePanel';
import AgentSessionsPanel from './components/AgentSessionsPanel';
import UsageReport from './components/UsageReport';

// The tabs of an agent's page besides its settings, registered here rather than wired into
// the sheet: the shape of @helena/sdk's `agent-section` UI slot (id, label, icon, order, the
// agent kinds it applies to, a component given the agent), so they move onto that registry
// once hub/framework is merged and a plugin can add its own the same way.

export interface AgentTabProps {
  teamId: number;
  agent: AiAgent;
  canEdit: boolean;
  runId: number | null;
  onRunChange: (runId: number | null) => void;
}

export interface AgentTab {
  id: string;
  // Key under agentRuntime.tabs.
  label: 'runs' | 'sessions' | 'memory' | 'usage' | 'runtime';
  icon: LucideIcon;
  order: number;
  kinds: AiAgent['kind'][];
  // Shown only for an agent whose runtime reports this capability.
  capability?: string;
  component: ComponentType<AgentTabProps>;
}

export const AGENT_TABS: AgentTab[] = [
  {
    id: 'runs',
    label: 'runs',
    icon: Waypoints,
    order: 10,
    kinds: ['external', 'internal'],
    component: ({ teamId, agent, runId, onRunChange }) => (
      <AgentRunsPanel teamId={teamId} agentId={agent.id} runId={runId} onRunChange={onRunChange} />
    ),
  },
  {
    id: 'sessions',
    label: 'sessions',
    icon: MessagesSquare,
    order: 20,
    kinds: ['external'],
    capability: 'sessions',
    component: ({ teamId, agent }) => <AgentSessionsPanel teamId={teamId} agentId={agent.id} />,
  },
  {
    id: 'memory',
    label: 'memory',
    icon: Brain,
    order: 30,
    kinds: ['external'],
    component: ({ teamId, agent, canEdit }) => (
      <AgentMemoryPanel teamId={teamId} agent={agent} canEdit={canEdit} />
    ),
  },
  {
    id: 'usage',
    label: 'usage',
    icon: Gauge,
    order: 40,
    kinds: ['external', 'internal'],
    component: ({ teamId, agent }) => (
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <UsageReport
          teamId={teamId}
          agentId={agent.id}
          groupings={[
            { id: 'model', by: ['model'] },
            { id: 'day', by: ['day', 'model'] },
            { id: 'project', by: ['project', 'model'] },
          ]}
        />
      </div>
    ),
  },
  {
    id: 'runtime',
    label: 'runtime',
    icon: Server,
    order: 50,
    kinds: ['external'],
    component: ({ teamId, agent, canEdit }) => (
      <AgentRuntimePanel
        teamId={teamId}
        agentId={agent.id}
        canEdit={canEdit}
        capabilities={agent.runtimeState.capabilities}
        learnedSkills={(agent.runtimeState.inventory?.skills ?? [])
          .filter((skill) => skill.origin === 'agent')
          .map((skill) => skill.name)}
      />
    ),
  },
];

// The tabs an agent shows: its kind's, a template none (it runs nowhere), and one that needs
// a capability only when the agent's runtime reported it.
export function agentTabsFor(agent: AiAgent | null): AgentTab[] {
  if (!agent || agent.template) return [];
  return AGENT_TABS.filter(
    (tab) =>
      tab.kinds.includes(agent.kind) &&
      (!tab.capability || agent.runtimeState.capabilities.includes(tab.capability)),
  ).sort((a, b) => a.order - b.order);
}
