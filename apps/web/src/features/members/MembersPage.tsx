'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useShell } from '@/context/shellContext';
import { usePermissions } from '@/hooks/usePermissions';
import SectionPageView from '@/components/common/page/SectionPageView';
import InvitesManager from './components/invites/InvitesManager';
import MemberAddDialog from './components/members/MemberAddDialog';
import MembersList from './components/members/MembersList';

// The Members page (/project/:projectKey/members): who has access to the project.
// Pending invites sit above the members list; the header row's primary action opens
// the dialog that adds someone from the team or invites them by email.
export default function MembersPage() {
  const t = useTranslations('members');
  const { project } = useShell();
  const { can, isAdmin } = usePermissions();
  const [adding, setAdding] = useState(false);
  if (!project) return null;

  // Each mirrors the memberAdmin guard on the API: the matrix, or the standing of an
  // owner or manager of the team that runs the project.
  const canAdd = can('members_manage', 'create') || isAdmin;
  const canInvite = can('members_invite', 'create') || isAdmin;
  const canReadInvites = can('members_invite', 'read') || isAdmin;

  return (
    <SectionPageView title={t('title')} description={t('description')} wide>
      <InvitesManager projectKey={project.project.key} />
      <MembersList
        projectKey={project.project.key}
        teamId={project.project.teamId}
        primary={
          canAdd || canInvite
            ? { id: 'add', label: t('add.action'), icon: Plus, onClick: () => setAdding(true) }
            : undefined
        }
      />

      {adding && (
        <MemberAddDialog
          projectKey={project.project.key}
          projectName={project.project.name}
          teamId={project.project.teamId}
          teamName={project.project.teamName}
          canAdd={canAdd}
          canInvite={canInvite}
          canGrantOwner={isAdmin}
          canReadInvites={canReadInvites}
          onClose={() => setAdding(false)}
        />
      )}
    </SectionPageView>
  );
}
