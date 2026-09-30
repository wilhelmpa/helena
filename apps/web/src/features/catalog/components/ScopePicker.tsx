'use client';

import { Bot, FolderKanban, Library, Shield } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  Inline,
  PillButton,
  PopoverPick,
  Segmented,
  Stack,
  Text,
  type PickItem,
} from '@/design-system';
import { useAiAgentsQuery } from '@/services/aiAgents.service';
import { useProjectsQuery } from '@/services/projects.service';
import { useTeamRoleOptionsQuery } from '@/services/roles.service';
import type { ScopeChoice, ScopeMode } from '../utils/scope';

// Whom an adopted skill or MCP server is given to: the library only, a project, one agent
// or a role. The lists are the team's own (projects, agents without templates, roles).
export default function ScopePicker({
  teamId,
  value,
  onChange,
}: {
  teamId: number;
  value: ScopeChoice;
  onChange: (value: ScopeChoice) => void;
}) {
  const t = useTranslations('catalog.scope');
  const projects = (useProjectsQuery().data ?? []).filter(
    (project) => project.teamId === teamId && project.projectRole !== 'home',
  );
  const agents = (useAiAgentsQuery(teamId).data ?? []).filter((agent) => !agent.template);
  const roles = useTeamRoleOptionsQuery(teamId).data ?? [];
  const set = (patch: Partial<ScopeChoice>) => onChange({ ...value, ...patch });
  const project = projects.find((entry) => entry.id === value.projectId);
  const agent = agents.find((entry) => entry.id === value.agentId);
  const role = roles.find((entry) => entry.id === value.roleId);

  const projectItems = (optional: boolean): PickItem[] => [
    ...(optional
      ? [
          {
            key: 'any',
            search: t('anyProject'),
            icon: <FolderKanban />,
            label: t('anyProject'),
            selected: value.projectId == null,
            onSelect: () => set({ projectId: null }),
          },
        ]
      : []),
    ...projects.map((entry) => ({
      key: String(entry.id),
      search: `${entry.key} ${entry.name}`,
      icon: <FolderKanban />,
      label: `${entry.key} · ${entry.name}`,
      selected: entry.id === value.projectId,
      onSelect: () => set({ projectId: entry.id }),
    })),
  ];

  return (
    <Stack gap={3}>
      <Segmented<ScopeMode>
        label={t('label')}
        value={value.mode}
        onChange={(mode) => set({ mode })}
        options={[
          { value: 'library', label: t('modes.library'), icon: <Library /> },
          { value: 'project', label: t('modes.project'), icon: <FolderKanban /> },
          { value: 'agent', label: t('modes.agent'), icon: <Bot /> },
          { value: 'role', label: t('modes.role'), icon: <Shield /> },
        ]}
      />
      <Text size="xs" tone="muted">
        {t(`hints.${value.mode}`)}
      </Text>
      {value.mode === 'project' && (
        <Inline>
          <PopoverPick
            inputPlaceholder={t('searchProject')}
            emptyText={t('noProjects')}
            items={projectItems(false)}
            trigger={
              <PillButton icon={<FolderKanban />} tone={project ? 'active' : 'neutral'}>
                {project ? `${project.key} · ${project.name}` : t('pickProject')}
              </PillButton>
            }
          />
        </Inline>
      )}
      {value.mode === 'agent' && (
        <Inline>
          <PopoverPick
            inputPlaceholder={t('searchAgent')}
            emptyText={t('noAgents')}
            items={agents.map((entry) => ({
              key: String(entry.id),
              search: entry.name,
              icon: <Bot />,
              label: entry.name,
              selected: entry.id === value.agentId,
              onSelect: () => set({ agentId: entry.id }),
            }))}
            trigger={
              <PillButton icon={<Bot />} tone={agent ? 'active' : 'neutral'}>
                {agent?.name ?? t('pickAgent')}
              </PillButton>
            }
          />
        </Inline>
      )}
      {value.mode === 'role' && (
        <Inline gap={2} wrap>
          <PopoverPick
            inputPlaceholder={t('searchRole')}
            emptyText={t('noRoles')}
            items={roles.map((entry) => ({
              key: String(entry.id),
              search: entry.name,
              icon: <Shield />,
              label: entry.name,
              selected: entry.id === value.roleId,
              onSelect: () => set({ roleId: entry.id }),
            }))}
            trigger={
              <PillButton icon={<Shield />} tone={role ? 'active' : 'neutral'}>
                {role?.name ?? t('pickRole')}
              </PillButton>
            }
          />
          <PopoverPick
            inputPlaceholder={t('searchProject')}
            emptyText={t('noProjects')}
            items={projectItems(true)}
            trigger={
              <PillButton icon={<FolderKanban />} tone={project ? 'active' : 'neutral'}>
                {project ? `${project.key} · ${project.name}` : t('anyProject')}
              </PillButton>
            }
          />
        </Inline>
      )}
    </Stack>
  );
}
