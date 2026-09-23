'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import {
  MAX_AGENT_NETWORK_DOMAINS,
  type AgentNetworkAgentOverride,
  type AgentNetworkMode,
} from '@/lib/api/endpoints/agentNetwork';
import { effectiveAgentMode } from '@/utils/agentNetworkMode';
import { parseDomainList } from '@/utils/domainList';
import { usePermissions } from '@/hooks/usePermissions';
import {
  useAgentNetworkSettingsQuery,
  useUpdateAgentNetworkSettings,
} from '@/services/agentNetwork.service';

// An agent's mode, keyed by its id as a string (matching the API's PUT body and
// the sanitize step on GET). null means "follows the project".
type AgentModeMap = Record<string, AgentNetworkMode | null>;

export interface AgentNetworkForm {
  editable: boolean;
  saving: boolean;
  justSaved: boolean;
  errorMessage: string | null;
  canSave: boolean;
  save: () => Promise<void>;
  mode: AgentNetworkMode;
  setMode: (mode: AgentNetworkMode) => void;
  allowText: string;
  setAllowText: (value: string) => void;
  allowCount: number;
  denyText: string;
  setDenyText: (value: string) => void;
  denyCount: number;
  mailPorts: boolean;
  setMailPorts: (value: boolean) => void;
  // Every agent of the project, for the per-agent overrides list.
  agents: AgentNetworkAgentOverride[];
  agentModes: AgentModeMap;
  setAgentMode: (agentId: number, mode: AgentNetworkMode | null) => void;
  // Whether the allow list currently governs at least one destination: the project
  // itself is in allowlist mode, or some agent's own override is.
  allowListActive: boolean;
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function sameAgentModes(map: AgentModeMap, agents: AgentNetworkAgentOverride[]): boolean {
  return agents.every((agent) => (map[String(agent.id)] ?? null) === agent.mode);
}

// Form state for the Network settings page: the egress mode, the allow/deny lists
// (typed as free text, one domain per line), the mail-port switch and the agents'
// own overrides. Seeds from the stored settings and reseeds with what the API
// actually stored after a save, so the fields always reflect the normalized values,
// not the raw text typed in.
export function useAgentNetworkForm(projectKey: string): AgentNetworkForm {
  const t = useTranslations('settings.network');
  const { can } = usePermissions();
  const settingsQuery = useAgentNetworkSettingsQuery(projectKey);
  const updateSettings = useUpdateAgentNetworkSettings(projectKey);

  const [mode, setMode] = useState<AgentNetworkMode>('open');
  const [allowText, setAllowText] = useState('');
  const [denyText, setDenyText] = useState('');
  const [mailPorts, setMailPorts] = useState(false);
  const [agentModes, setAgentModes] = useState<AgentModeMap>({});

  const data = settingsQuery.data;
  useEffect(() => {
    if (!data) return;
    setMode(data.mode);
    setAllowText(data.allow.join('\n'));
    setDenyText(data.deny.join('\n'));
    setMailPorts(data.mailPorts);
    setAgentModes(Object.fromEntries(data.agents.map((agent) => [String(agent.id), agent.mode])));
  }, [data]);

  const allowList = useMemo(() => parseDomainList(allowText), [allowText]);
  const denyList = useMemo(() => parseDomainList(denyText), [denyText]);
  const agents = data?.agents ?? [];

  const dirty =
    data != null &&
    (mode !== data.mode ||
      mailPorts !== data.mailPorts ||
      !sameList(allowList, data.allow) ||
      !sameList(denyList, data.deny) ||
      !sameAgentModes(agentModes, data.agents));

  const editable = can('ai_agents', 'edit');
  const withinLimits =
    allowList.length <= MAX_AGENT_NETWORK_DOMAINS && denyList.length <= MAX_AGENT_NETWORK_DOMAINS;

  const allowListActive =
    mode === 'allowlist' ||
    agents.some(
      (agent) => effectiveAgentMode(agentModes[String(agent.id)] ?? null, mode) === 'allowlist',
    );

  function setAgentMode(agentId: number, next: AgentNetworkMode | null) {
    setAgentModes((prev) => ({ ...prev, [String(agentId)]: next }));
  }

  async function save() {
    const agentsPatch: Record<string, AgentNetworkMode | null> = {};
    for (const agent of agents) {
      const next = agentModes[String(agent.id)] ?? null;
      if (next !== agent.mode) agentsPatch[String(agent.id)] = next;
    }
    const saved = await updateSettings.mutateAsync({
      mode,
      allow: allowList,
      deny: denyList,
      mailPorts,
      ...(Object.keys(agentsPatch).length > 0 ? { agents: agentsPatch } : {}),
    });
    setMode(saved.mode);
    setAllowText(saved.allow.join('\n'));
    setDenyText(saved.deny.join('\n'));
    setMailPorts(saved.mailPorts);
    setAgentModes(Object.fromEntries(saved.agents.map((agent) => [String(agent.id), agent.mode])));
    toast.success(t('saved'));
  }

  return {
    editable,
    saving: updateSettings.isPending,
    justSaved: updateSettings.isSuccess && !dirty,
    errorMessage:
      updateSettings.isError && updateSettings.error instanceof Error
        ? updateSettings.error.message
        : null,
    canSave:
      editable && settingsQuery.isSuccess && dirty && withinLimits && !updateSettings.isPending,
    save,
    mode,
    setMode,
    allowText,
    setAllowText,
    allowCount: allowList.length,
    denyText,
    setDenyText,
    denyCount: denyList.length,
    mailPorts,
    setMailPorts,
    agents,
    agentModes,
    setAgentMode,
    allowListActive,
  };
}
