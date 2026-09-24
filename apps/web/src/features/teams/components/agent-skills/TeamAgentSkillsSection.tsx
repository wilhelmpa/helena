'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTeamQuery } from '@/services/teams.service';
import SectionPageView from '@/components/common/page/SectionPageView';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { SkillCreateDialog } from './SkillCreateDialog';
import TeamAgentSkills from './TeamAgentSkills';
import { PageActions, PageToolbar, PageToolbarSpacer } from '@/components/layout/PageToolbar';

// The skill library of a team: the SKILL.md documents its projects' internal agents
// load on demand, shared by every one of them.
export default function TeamAgentSkillsSection({ teamId }: { teamId: number }) {
  const t = useTranslations('teams');
  const { data: team } = useTeamQuery(teamId);
  const permissions = team?.permissions.agent_skills;
  const [creating, setCreating] = useState(false);

  return (
    <SectionPageView
      title={t('sections.agentSkills.title')}
      description={t('sections.agentSkills.description')}
      wide
    >
      <PageToolbar>
        <PageToolbarSpacer />
        <PageActions
          primary={
            permissions?.create
              ? {
                  id: 'new',
                  label: t('skills.newSkill'),
                  icon: Plus,
                  onClick: () => setCreating(true),
                }
              : undefined
          }
        />
      </PageToolbar>
      {!permissions || !team ? (
        <ListSkeleton rows={3} rowClassName="h-12" />
      ) : !permissions.read ? (
        <p className="text-sm text-muted-foreground">{t('skills.noAccess')}</p>
      ) : (
        <TeamAgentSkills teamId={teamId} teamName={team.name} permissions={permissions} />
      )}

      {creating && team && (
        <SkillCreateDialog
          teamId={teamId}
          teamName={team.name}
          onClose={() => setCreating(false)}
        />
      )}
    </SectionPageView>
  );
}
