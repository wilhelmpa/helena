'use client';

import { useTranslations } from 'next-intl';
import type { CatalogScope } from '@/lib/api/endpoints/catalog';
import { useAiAgentsQuery } from '@/services/aiAgents.service';
import { useProjectsQuery } from '@/services/projects.service';
import { useTeamRoleOptionsQuery } from '@/services/roles.service';

// Whom an installed entry was given to, as one phrase ("Projekt VOL · volition.one").
export default function ScopeLabel({
  teamId,
  scope,
}: {
  teamId: number;
  scope: CatalogScope | null | undefined;
}) {
  const t = useTranslations('catalog.scope');
  const projects = useProjectsQuery().data ?? [];
  const agents = useAiAgentsQuery(teamId).data ?? [];
  const roles = useTeamRoleOptionsQuery(teamId).data ?? [];
  const project = projects.find((entry) => entry.id === scope?.projectId);
  const projectName = project ? `${project.key} · ${project.name}` : t('unknownProject');
  if (scope?.agentId) {
    const agent = agents.find((entry) => entry.id === scope.agentId);
    return <>{t('phrase.agent', { name: agent?.name ?? t('unknownAgent') })}</>;
  }
  if (scope?.roleId) {
    const role = roles.find((entry) => entry.id === scope.roleId);
    const name = role?.name ?? t('unknownRole');
    return (
      <>
        {scope.projectId
          ? t('phrase.roleInProject', { name, project: projectName })
          : t('phrase.role', { name })}
      </>
    );
  }
  if (scope?.projectId) return <>{t('phrase.project', { name: projectName })}</>;
  return <>{t('phrase.library')}</>;
}
