import { createContext, useContext } from 'react';
import type { AiAgent } from '@/lib/api/endpoints/agents';

// The agent's settings as pages (docs/design-system.md §3/§4, owner 28.09.: "man wird
// erschlagen"): in the agent dialog each group of the form is a page of its own, picked
// in the dialog's left column, instead of one long column of collapsible sections. The
// same sections keep their collapsible form wherever the form is shown as a column
// (a project's agent sheet).

export type AgentFormPageId =
  | 'general'
  | 'instructions'
  | 'projects'
  | 'autopilot'
  | 'runtime-policy'
  | 'triggers'
  | 'heartbeat'
  | 'abilities'
  | 'learning'
  | 'skills'
  | 'tools'
  | 'access'
  | 'environment'
  | 'token'
  | 'runner';

export type AgentFormPageGroup = 'basics' | 'work' | 'abilities' | 'technical';

export type AgentFormPage = { id: AgentFormPageId; group: AgentFormPageGroup };

// The pages an agent has, in their order: a template works in no project and has no
// Autopilot, environment or runs; tools need their own permission. The skills of an agent
// are the Skills tab of the dialog; a template has no tabs (it runs nowhere), so its skills
// are a page of the form.
export function agentFormPages(
  agent: AiAgent | null,
  can: { skills: boolean; tools: boolean },
): AgentFormPage[] {
  const runs = agent != null && !agent.template;
  const pages: (AgentFormPage | false)[] = [
    { id: 'general', group: 'basics' },
    { id: 'instructions', group: 'basics' },
    !agent?.template && { id: 'projects', group: 'basics' },
    runs && { id: 'autopilot', group: 'work' },
    { id: 'runtime-policy', group: 'work' },
    { id: 'triggers', group: 'work' },
    { id: 'heartbeat', group: 'work' },
    { id: 'abilities', group: 'abilities' },
    { id: 'learning', group: 'abilities' },
    agent?.template === true && can.skills && { id: 'skills', group: 'abilities' },
    can.tools && { id: 'tools', group: 'abilities' },
    { id: 'access', group: 'technical' },
    runs && { id: 'environment', group: 'technical' },
    { id: 'token', group: 'technical' },
    { id: 'runner', group: 'technical' },
  ];
  return pages.filter((page): page is AgentFormPage => page !== false);
}

// Where the agent dialog stands: its tab (settings, runs, memory …) and, on the settings
// tab, the page of the form. Absent outside the dialog.
export type AgentDialogState = {
  tab: string;
  setTab: (tab: string) => void;
  page: AgentFormPageId;
  setPage: (page: AgentFormPageId) => void;
};

export const AgentDialogCtx = createContext<AgentDialogState | null>(null);
export function useAgentDialog(): AgentDialogState | null {
  return useContext(AgentDialogCtx);
}

// Inside a page, a section shows open and without its fold-out header row.
export const AgentFormPageModeCtx = createContext(false);
