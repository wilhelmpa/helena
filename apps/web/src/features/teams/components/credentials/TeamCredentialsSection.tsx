'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { CredentialEntry, CredentialKind } from '@/lib/api/endpoints/credentials';
import { useTeamQuery } from '@/services/teams.service';
import { useCredentialsPageQuery, useDeleteCredential } from '@/services/credentials.service';
import SectionPageView from '@/components/common/page/SectionPageView';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { EmptyState } from '@/components/common/page/EmptyState';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import ListPager from '@/components/common/ListPager';
import { usePaging } from '@/hooks/usePaging';
import { AddCredentialMenu } from './AddCredentialMenu';
import { CredentialAuditDialog } from './CredentialAuditDialog';
import { CredentialDialog } from './CredentialDialog';
import { CredentialGrantsDialog } from './CredentialGrantsDialog';
import { CredentialKindFilter } from './CredentialKindFilter';
import { CredentialRow } from './CredentialRow';

type Open =
  | { dialog: 'edit'; entry: CredentialEntry }
  | { dialog: 'new'; kind: CredentialKind }
  | { dialog: 'grants' | 'audit' | 'delete'; entry: CredentialEntry };

// The Credentials page: the team's website logins, API keys, SSH keys and secrets. Its
// owners and managers add, change and grant them; a member whose role reads the team's
// integrations sees them.
export default function TeamCredentialsSection({ teamId }: { teamId: number }) {
  const t = useTranslations('credentials');
  const { data: team } = useTeamQuery(teamId);
  const canRead = team?.permissions.integrations.read ?? false;
  const canManage = team?.role === 'owner' || team?.role === 'manager';
  const [kind, setKind] = useState<CredentialKind | undefined>();
  const paging = usePaging();
  const page = useCredentialsPageQuery(teamId, paging.params, kind);
  const deleteCredential = useDeleteCredential(teamId);
  const [open, setOpen] = useState<Open | null>(null);
  const close = () => setOpen(null);

  return (
    <SectionPageView
      title={t('title')}
      description={canManage ? t('description') : `${t('description')} ${t('managerOnly')}`}
      actions={
        canManage ? (
          <AddCredentialMenu onSelect={(next) => setOpen({ dialog: 'new', kind: next })} />
        ) : undefined
      }
    >
      {!team ? (
        <ListSkeleton rows={3} rowClassName="h-14" />
      ) : !canRead ? (
        <p className="text-sm text-muted-foreground">{t('noAccess')}</p>
      ) : (
        <div className="space-y-4">
          <CredentialKindFilter
            value={kind}
            onChange={(next) => {
              setKind(next);
              paging.reset();
            }}
          />
          {!page.data ? (
            <ListSkeleton rows={3} rowClassName="h-14" />
          ) : page.data.total === 0 ? (
            <EmptyState title={t('empty')} description={t('emptyHint')} />
          ) : (
            <>
              <ul className="divide-y">
                {page.data.items.map((entry) => (
                  <CredentialRow
                    key={entry.id}
                    entry={entry}
                    canManage={canManage}
                    onOpen={(dialog) => setOpen({ dialog, entry })}
                  />
                ))}
              </ul>
              <ListPager paging={paging} total={page.data.total} />
            </>
          )}
        </div>
      )}

      {open?.dialog === 'new' && (
        <CredentialDialog teamId={teamId} kind={open.kind} entry={null} onClose={close} />
      )}
      {open?.dialog === 'edit' && (
        <CredentialDialog
          teamId={teamId}
          kind={open.entry.kind}
          entry={open.entry}
          onClose={close}
        />
      )}
      {open?.dialog === 'grants' && (
        <CredentialGrantsDialog teamId={teamId} entry={open.entry} onClose={close} />
      )}
      {open?.dialog === 'audit' && (
        <CredentialAuditDialog teamId={teamId} entry={open.entry} onClose={close} />
      )}
      {open?.dialog === 'delete' && (
        <ConfirmDialog
          title={t('delete')}
          confirmLabel={t('delete')}
          onConfirm={async () => {
            await deleteCredential.mutateAsync(open.entry.id);
            close();
          }}
          onClose={close}
        >
          <div className="text-sm text-muted-foreground">
            {t('deleteMessage', { name: open.entry.label })}
          </div>
        </ConfirmDialog>
      )}
    </SectionPageView>
  );
}
