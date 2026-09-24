'use client';

import { useTranslations } from 'next-intl';
import { useTeam, useTeamProjectOptionsQuery, useUpdateTeamMcp } from '@/services/teams.service';
import SectionPageView from '@/components/common/page/SectionPageView';
import SettingsCard from '@/components/common/page/SettingsCard';
import SettingsSection from '@/components/common/page/SettingsSection';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { Switch } from '@/components/ui/switch';
import McpConnectionGuide from '@/features/mcp/components/McpConnectionGuide';
import { TeamSettingState } from '../TeamSettingState';

// The team's MCP settings: the switch that opens the team to MCP clients at all, and
// which of its projects that reach covers, then how a client connects. Owners and
// managers set both; a plain member reads them. A project does not open itself — its
// own MCP page only reports the state and who to ask.
export default function TeamMcpSection({ teamId }: { teamId: number }) {
  const t = useTranslations('teams.mcp');
  const team = useTeam(teamId);
  const { data: projects } = useTeamProjectOptionsQuery(teamId);
  const update = useUpdateTeamMcp(teamId);

  const canManage = team != null && team.role !== 'member';
  const enabled = team?.mcpEnabled ?? false;
  const busy = update.isPending;

  return (
    <SectionPageView title={t('title')} wide>
      <div className="space-y-6">
        <SettingsSection title={t('access')}>
          <SettingsCard>
            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <p className="text-sm">{canManage ? t('accessHint') : t('managerOnly')}</p>
              {canManage ? (
                <Switch
                  checked={enabled}
                  disabled={busy}
                  onCheckedChange={(value) => update.mutate({ enabled: value })}
                  aria-label={t('toggleAria')}
                />
              ) : (
                <TeamSettingState on={enabled} />
              )}
            </div>
          </SettingsCard>
        </SettingsSection>

        {enabled && (
          <>
            <SettingsSection title={t('projects')} description={t('projectsHint')}>
              {!projects ? (
                <ListSkeleton rows={3} rowClassName="h-11" />
              ) : (
                <SettingsCard className="divide-y">
                  {projects.length === 0 ? (
                    <p className="px-4 py-3 text-sm text-muted-foreground">{t('noProjects')}</p>
                  ) : (
                    projects.map((project) => (
                      <div
                        key={project.id}
                        className="flex min-h-11 items-center justify-between gap-4 px-4 py-2"
                      >
                        <div className="min-w-0 truncate">
                          <span className="text-sm font-medium">{project.name}</span>
                          <span className="ms-2 font-mono text-xs text-muted-foreground">
                            {project.key}
                          </span>
                        </div>
                        {canManage ? (
                          <Switch
                            checked={project.mcpEnabled}
                            disabled={busy}
                            onCheckedChange={(value) =>
                              update.mutate({
                                projects: [{ projectId: project.id, enabled: value }],
                              })
                            }
                            aria-label={t('projectToggleAria', { project: project.name })}
                          />
                        ) : (
                          <TeamSettingState on={project.mcpEnabled} />
                        )}
                      </div>
                    ))
                  )}
                </SettingsCard>
              )}
            </SettingsSection>

            <McpConnectionGuide />
          </>
        )}
      </div>
    </SectionPageView>
  );
}
