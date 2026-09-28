'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { InviteRow as Invite } from '@/lib/api/endpoints/invites';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import { ItemGroup } from '@/components/ui/item';
import { useDeleteInvite, useInvitesQuery, useSendInviteEmail } from '@/services/members.service';
import { usePermissions } from '@/hooks/usePermissions';
import InviteRow from './InviteRow';
import { Box } from '@/design-system';

// Invite panel shown above the members list: the invites that have not been accepted
// or rejected yet, each with a revoke action. Sending one is the page's own action.
// Mirrors the memberAdmin guard on the API — the members_invite matrix, or the
// standing of an owner or manager of the team — and renders nothing without it.
export default function InvitesManager({ projectKey }: { projectKey: string }) {
  const t = useTranslations('members.invites');
  const { can, isAdmin } = usePermissions();
  const canRead = can('members_invite', 'read') || isAdmin;
  const canCreate = can('members_invite', 'create') || isAdmin;
  const canDelete = can('members_invite', 'delete') || isAdmin;
  const invitesQuery = useInvitesQuery(projectKey, canRead);
  const deleteInvite = useDeleteInvite(projectKey);
  const sendEmail = useSendInviteEmail(projectKey);
  const [target, setTarget] = useState<Invite | null>(null);

  function resendInvite(invite: Invite) {
    sendEmail.mutate(invite.id);
  }

  if (!canRead) return null;

  const pending = (invitesQuery.data ?? []).filter((invite) => invite.status === 'pending');
  if (pending.length === 0) return null;

  return (
    <div>
      <Box marginBottom={5}>
        <Box
          marginBottom={1}
          padBottom={1}
          className="border-b text-xs font-medium text-muted-foreground"
        >
          {t('pendingCount', { count: pending.length })}
        </Box>
        <ItemGroup>
          {pending.map((invite) => (
            <InviteRow
              key={invite.id}
              invite={invite}
              onResend={canCreate ? resendInvite : undefined}
              onRevoke={canDelete ? setTarget : undefined}
              resending={sendEmail.isPending && sendEmail.variables === invite.id}
            />
          ))}
        </ItemGroup>
      </Box>

      {canDelete && target && (
        <ConfirmDialog
          title={t('revokeTitle', { email: target.email })}
          confirmLabel={t('revokeConfirm')}
          onConfirm={async () => {
            await deleteInvite.mutateAsync(target.id);
            setTarget(null);
          }}
          onClose={() => setTarget(null)}
        >
          <div className="text-sm text-muted-foreground">{t('revokeDescription')}</div>
        </ConfirmDialog>
      )}
    </div>
  );
}
