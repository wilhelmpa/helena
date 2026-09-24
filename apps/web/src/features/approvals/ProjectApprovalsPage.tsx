'use client';

import { useTranslations } from 'next-intl';
import { useShell } from '@/context/shellContext';
import RequirePermission from '@/components/common/permissions/RequirePermission';
import SectionPageView from '@/components/common/page/SectionPageView';
import ApprovalsView from './components/ApprovalsView';

// This project's own approvals: the requests its agents made before acting outside
// Helena, and the workflow runs of this project waiting at an approval gate. The same
// view as the global Approvals page, narrowed to one project.
export default function ProjectApprovalsPage() {
  const tNav = useTranslations('nav');
  const t = useTranslations('approvals');
  const { project } = useShell();
  if (!project) return null;

  return (
    <SectionPageView title={tNav('approvals')} wide>
      <RequirePermission resource="ai_agents" action="edit">
        <ApprovalsView fixedProjectKey={project.project.key} />
      </RequirePermission>
    </SectionPageView>
  );
}
