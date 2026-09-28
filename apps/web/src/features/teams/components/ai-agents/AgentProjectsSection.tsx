import { FolderKanban } from 'lucide-react';
import type { TeamProjectOption } from '@/lib/api/endpoints/teams';
import type { AgentFormValue } from '../../utils/agentForm';
import { AgentCapabilityList } from './AgentCapabilityList';
import { AgentEmptyNotice } from './AgentEmptyNotice';
import { AgentFormSection } from './AgentFormSection';
import { Switch } from '@/components/ui/switch';
import { SettingsGroup, SettingsRow } from '@/design-system';
import { useTeamQuery } from '@/services/teams.service';
import { useAgentSection } from '../../context/agentSection';
import { useTranslations } from 'next-intl';

// The projects of the team the agent works in. Membership is what lets its key reach a
// project, so this is where an operator attaches and detaches one; an agent with none
// authenticates and reaches nothing.
export default function AgentProjectsSection({
  open,
  onOpenChange,
  value,
  onChange,
  projects,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: AgentFormValue;
  onChange: (patch: Partial<AgentFormValue>) => void;
  projects: TeamProjectOption[];
}) {
  const t = useTranslations('teams.agents');
  const { teamId } = useAgentSection();
  const role = useTeamQuery(teamId).data?.role;
  const canGrantAll = role === 'owner' || role === 'manager';

  function toggle(id: number, on: boolean) {
    onChange({
      projectIds: on
        ? [...new Set([...value.projectIds, id])]
        : value.projectIds.filter((x) => x !== id),
    });
  }

  return (
    <AgentFormSection
      open={open}
      onOpenChange={onOpenChange}
      icon={FolderKanban}
      title={t('projects')}
      hint={t('projectsHint')}
      headerRight={
        value.projectScope === 'all'
          ? t('allProjectsScope')
          : projects.length > 0
            ? `${value.projectIds.length} / ${projects.length}`
            : undefined
      }
    >
      {canGrantAll && !value.template && (
        <SettingsGroup>
          <SettingsRow label={t('allProjectsScope')} description={t('allProjectsScopeHint')}>
            <Switch
              id="agent-project-scope-all"
              aria-label={t('allProjectsScope')}
              checked={value.projectScope === 'all'}
              onCheckedChange={(checked) =>
                onChange({
                  projectScope: checked ? 'all' : 'selected',
                  projectId: checked ? null : value.projectId,
                })
              }
            />
          </SettingsRow>
        </SettingsGroup>
      )}
      {value.projectScope === 'all' ? null : projects.length === 0 ? (
        <AgentEmptyNotice icon={FolderKanban} title={t('noProjects')} hint={t('noProjectsHint')} />
      ) : (
        <AgentCapabilityList
          searchPlaceholder={t('searchProjects')}
          onToggle={toggle}
          items={projects.map((project) => ({
            id: project.id,
            checked: value.projectIds.includes(project.id),
            title: project.name,
            subtitle: project.key,
            search: `${project.name} ${project.key}`.toLowerCase(),
          }))}
        />
      )}
    </AgentFormSection>
  );
}
