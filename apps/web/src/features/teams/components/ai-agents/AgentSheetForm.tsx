import { useEffect, useState } from 'react';
import { Sparkles, Wrench } from 'lucide-react';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import { teamSectionPath } from '@/utils/paths';
import {
  useCreateAiAgent,
  useUpdateAiAgent,
  useAgentChatCatalogQuery,
} from '@/services/aiAgents.service';
import { useIntegrationCatalogQuery } from '@/services/integrations.service';
import { useTeamProjectOptionsQuery, useTeamQuery } from '@/services/teams.service';
import {
  useSkillOptionsQuery,
  useAgentSkillsQuery,
  useSetAgentSkills,
} from '@/services/agentSkills.service';
import {
  useConfiguredToolOptionsQuery,
  useAgentToolLinksQuery,
  useSetAgentTools,
} from '@/services/customTools.service';
import {
  useAgentMcpServersQuery,
  useMcpServersQuery,
  useSetAgentMcpServers,
} from '@/services/agentMcpServers.service';
import { Button } from '@/components/ui/button';
import { useAgentSection } from '../../context/agentSection';
import { AgentCapabilityList } from './AgentCapabilityList';
import AgentLibraryMcpServers from './AgentLibraryMcpServers';
import { AgentEmptyNotice } from './AgentEmptyNotice';
import TeamAiAgentFields, { AGENT_EXPANDED_WIDTH } from './TeamAiAgentFields';
import {
  initialAgentValue,
  isAgentFormValid,
  suggestUsername,
  toCreateInput,
  toUpdatePatch,
  type AgentFormValue,
} from '../../utils/agentForm';
import { integrationLabel } from '@/utils/integrationLabels';
import { useTranslations } from 'next-intl';

// The Edit tab of the agent sheet, used for both create and edit. With no agent it
// creates one; once created (onCreated lifts it to the sheet) the same form switches
// to editing that agent without remounting, so the entered values stay. A new agent's
// key is revealed once in the API key section. Its skills, tools and MCP servers are
// linked through endpoints of their own once the agent exists.
export function AgentSheetForm({
  agent,
  projectId,
  expanded = false,
  onCreated,
  initialOpenSection,
}: {
  agent: AiAgent | null;
  // The project a new agent is created in, set when the sheet is opened from inside one.
  projectId?: number;
  expanded?: boolean;
  onCreated: (agent: AiAgent) => void;
  initialOpenSection?: string;
}) {
  const t = useTranslations('teams.agents');
  const tCommon = useTranslations('common');
  const [value, setValue] = useState<AgentFormValue>(() =>
    initialAgentValue(agent ?? undefined, projectId),
  );
  const isCreate = agent == null;
  // The plaintext key issued in this sheet, by the create or by a regenerate. It is
  // shown once in the API key section and cannot be read back from the server.
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  // While creating, the username is derived from the name until the user edits it.
  // Clearing the username field resumes auto-generation.
  const [usernameEdited, setUsernameEdited] = useState(false);

  // Skills are a separate permission; when the user can't manage them, the Skills
  // section is hidden and its queries and save are skipped (the backend enforces it
  // too).
  const { teamId } = useAgentSection();
  const team = useTeamQuery(teamId).data;
  const canManageSkills = team?.permissions.agent_skills.edit ?? false;
  const canManageTools = team?.permissions.agent_tools.edit ?? false;
  const canReadTools = team?.permissions.agent_tools.read ?? false;

  const projects = useTeamProjectOptionsQuery(teamId).data ?? [];
  const catalog = useIntegrationCatalogQuery(teamId).data ?? [];
  const chatCatalogQuery = useAgentChatCatalogQuery(teamId, agent?.id ?? null);
  const skillsLibraryQuery = useSkillOptionsQuery(canManageSkills ? teamId : null);
  const agentSkillsQuery = useAgentSkillsQuery(teamId, agent && canManageSkills ? agent.id : null);
  const toolsLibraryQuery = useConfiguredToolOptionsQuery(canManageTools ? teamId : null);
  const agentToolsQuery = useAgentToolLinksQuery(teamId, agent && canManageTools ? agent.id : null);
  const mcpLibraryQuery = useMcpServersQuery(canReadTools ? teamId : null);
  const agentMcpServersQuery = useAgentMcpServersQuery(
    teamId,
    agent && canReadTools ? agent.id : null,
  );

  const createAgent = useCreateAiAgent(teamId);
  const updateAgent = useUpdateAiAgent(teamId);
  const setAgentSkills = useSetAgentSkills(teamId);
  const setAgentTools = useSetAgentTools(teamId);
  const setAgentMcpServers = useSetAgentMcpServers(teamId);
  const saving =
    createAgent.isPending ||
    updateAgent.isPending ||
    setAgentSkills.isPending ||
    setAgentTools.isPending ||
    setAgentMcpServers.isPending;

  // The agent's enabled skills, seeded from the server once loaded (edit mode only).
  const [skillIds, setSkillIds] = useState<number[] | null>(null);
  useEffect(() => {
    if (agentSkillsQuery.data && skillIds === null) {
      setSkillIds(agentSkillsQuery.data.map((s) => s.id));
    }
  }, [agentSkillsQuery.data, skillIds]);
  const selectedSkills = skillIds ?? [];

  // The agent's enabled custom tools, seeded from the server once loaded (edit only).
  const [toolIds, setToolIds] = useState<number[] | null>(null);
  useEffect(() => {
    if (agentToolsQuery.data && toolIds === null) {
      setToolIds(agentToolsQuery.data.map((t) => t.id));
    }
  }, [agentToolsQuery.data, toolIds]);
  const selectedTools = toolIds ?? [];

  // The agent's servers of the team's MCP library, seeded from the server once loaded.
  const [mcpServerIds, setMcpServerIds] = useState<number[] | null>(null);
  useEffect(() => {
    if (agentMcpServersQuery.data && mcpServerIds === null) {
      setMcpServerIds(agentMcpServersQuery.data.map((server) => server.id));
    }
  }, [agentMcpServersQuery.data, mcpServerIds]);

  function merge(patch: Partial<AgentFormValue>) {
    setValue((prev) => {
      const next = { ...prev, ...patch };
      if (isCreate && 'name' in patch && !usernameEdited) {
        next.username = suggestUsername(next.name);
      }
      return next;
    });
    if ('username' in patch) setUsernameEdited((patch.username ?? '').trim() !== '');
  }

  function toggleSkill(id: number, on: boolean) {
    setSkillIds((prev) => {
      const base = prev ?? [];
      return on ? [...new Set([...base, id])] : base.filter((x) => x !== id);
    });
  }

  // The server enabled a promoted skill already. The selection only needs it while it is
  // loaded; one that is not reads the server's links, which include it.
  function addPromotedSkill(id: number) {
    setSkillIds((prev) => (prev === null ? null : [...new Set([...prev, id])]));
  }

  function toggleTool(id: number, on: boolean) {
    setToolIds((prev) => {
      const base = prev ?? [];
      return on ? [...new Set([...base, id])] : base.filter((x) => x !== id);
    });
  }

  function toggleMcpServer(id: number, on: boolean) {
    setMcpServerIds((prev) => {
      const base = prev ?? [];
      return on ? [...new Set([...base, id])] : base.filter((x) => x !== id);
    });
  }

  async function submit() {
    if (!isAgentFormValid(value) || saving) return;
    if (isCreate) {
      const res = await createAgent.mutateAsync(toCreateInput(value));
      // Link the picked skills/tools against the freshly created agent id (the join
      // tables need an id, which only exists after the create returns).
      if (canManageSkills && skillIds && skillIds.length > 0) {
        await setAgentSkills.mutateAsync({ agentId: res.agent.id, skillIds });
      }
      if (canManageTools && toolIds && toolIds.length > 0) {
        await setAgentTools.mutateAsync({ agentId: res.agent.id, agentToolIds: toolIds });
      }
      if (canManageTools && mcpServerIds && mcpServerIds.length > 0) {
        await setAgentMcpServers.mutateAsync({ agentId: res.agent.id, mcpServerIds });
      }
      setRevealedKey(res.apiKey);
      onCreated(res.agent);
    } else {
      await updateAgent.mutateAsync({ id: agent.id, patch: toUpdatePatch(value) });
      if (canManageSkills && skillIds !== null) {
        await setAgentSkills.mutateAsync({ agentId: agent.id, skillIds });
      }
      if (canManageTools && toolIds !== null) {
        await setAgentTools.mutateAsync({ agentId: agent.id, agentToolIds: toolIds });
      }
      if (canManageTools && mcpServerIds !== null) {
        await setAgentMcpServers.mutateAsync({ agentId: agent.id, mcpServerIds });
      }
    }
  }

  const skillsLibrary = skillsLibraryQuery.data ?? [];
  const showSkills = canManageSkills;

  // The Skills section body (the fields layout wraps it in a section). The configured
  // skill library the agent may load.
  const skillsContent = showSkills ? (
    skillsLibrary.length === 0 ? (
      <AgentEmptyNotice
        icon={Sparkles}
        title={t('noSkills')}
        hint={t('noSkillsHint')}
        href={teamSectionPath(teamId, 'agent-skills')}
        linkLabel={t('goToSkills')}
      />
    ) : (
      <AgentCapabilityList
        searchPlaceholder={t('searchSkills')}
        onToggle={toggleSkill}
        items={skillsLibrary.map((skill) => ({
          id: skill.id,
          checked: selectedSkills.includes(skill.id),
          title: skill.name,
          subtitle: skill.description || t('noDescription'),
          search: `${skill.name} ${skill.description ?? ''}`.toLowerCase(),
        }))}
      />
    )
  ) : null;

  const toolsLibrary = toolsLibraryQuery.data ?? [];
  const showTools = canManageTools;

  // The Tools section body: the configured custom tools the agent may call.
  const toolsContent = showTools ? (
    toolsLibrary.length === 0 ? (
      <AgentEmptyNotice
        icon={Wrench}
        title={t('noTools')}
        hint={t('noToolsHint')}
        href={teamSectionPath(teamId, 'agent-tools')}
        linkLabel={t('goToTools')}
      />
    ) : (
      <AgentCapabilityList
        searchPlaceholder={t('searchTools')}
        onToggle={toggleTool}
        items={toolsLibrary.map((tool) => {
          const toolLabel =
            catalog.flatMap((i) => i.tools).find((t) => t.key === tool.toolKey)?.label ??
            tool.toolKey;
          const integration = integrationLabel(catalog, tool.integrationKey);
          return {
            id: tool.id,
            checked: selectedTools.includes(tool.id),
            title: toolLabel,
            subtitle: tool.credentialLabel ?? undefined,
            group: integration,
            search: `${toolLabel} ${integration} ${tool.credentialLabel ?? ''}`.toLowerCase(),
          };
        })}
      />
    )
  ) : null;

  // Shown once the agent's own servers are known, so a toggle never starts from none.
  const mcpServersContent =
    canReadTools && mcpLibraryQuery.data && (isCreate || mcpServerIds !== null) ? (
      <AgentLibraryMcpServers
        teamId={teamId}
        servers={mcpLibraryQuery.data}
        selected={mcpServerIds ?? []}
        canEdit={canManageTools}
        onToggle={toggleMcpServer}
      />
    ) : null;

  // "enabled / available" over each capability library, shown in the section header
  // and its nav entry. Nothing to count while the library is empty.
  const countBadge = (selected: number, total: number) =>
    total > 0 ? `${selected} / ${total}` : undefined;

  // In the sheet the form owns its scroll container: it holds the section nav, whose
  // scroll spy needs that root. The compact side panel stacks in a single column here.
  const contentWidth = expanded ? AGENT_EXPANDED_WIDTH : '';

  const fields = (
    <TeamAiAgentFields
      value={value}
      onChange={merge}
      projects={projects}
      expanded={expanded}
      chatModels={chatCatalogQuery.data?.models ?? []}
      localModels={chatCatalogQuery.data?.localModels ?? []}
      chatModelsUnavailable={chatCatalogQuery.data?.unavailable ?? []}
      agent={agent}
      skillsContent={skillsContent}
      skillsBadge={countBadge(selectedSkills.length, skillsLibrary.length)}
      toolsContent={toolsContent}
      toolsBadge={countBadge(selectedTools.length, toolsLibrary.length)}
      mcpServersContent={mcpServersContent}
      onSkillPromoted={addPromotedSkill}
      revealedKey={revealedKey}
      onRevealedKey={setRevealedKey}
      initialOpenSection={initialOpenSection}
    />
  );

  return (
    <form
      className="flex h-full min-h-0 flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {expanded ? (
        fields
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-6">
          <div className={`mx-auto w-full space-y-6 ${contentWidth}`}>{fields}</div>
        </div>
      )}
      <div className="border-t border-border/60 px-4 py-3">
        <div className={`mx-auto flex w-full ${contentWidth} ${expanded ? 'justify-end' : ''}`}>
          <Button
            type="submit"
            className={expanded ? 'min-w-40' : 'w-full'}
            disabled={!isAgentFormValid(value) || saving}
          >
            {saving ? tCommon('saving') : isCreate ? t('create') : t('save')}
          </Button>
        </div>
      </div>
    </form>
  );
}
