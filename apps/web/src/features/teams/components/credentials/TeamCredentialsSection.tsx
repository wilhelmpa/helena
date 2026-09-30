'use client';

import { Card } from '@/design-system';
import { useState, type ReactNode } from 'react';
import { ListFilter } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { CredentialEntry, CredentialKind, ListedKind } from '@/lib/api/endpoints/credentials';
import { useTeamQuery } from '@/services/teams.service';
import { useCredentialsPageQuery, useDeleteCredential } from '@/services/credentials.service';
import SectionPageView from '@/components/common/page/SectionPageView';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { EmptyState } from '@/components/common/page/EmptyState';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import ListPager from '@/components/common/ListPager';
import { usePaging } from '@/hooks/usePaging';
import { AddCredentialMenu } from './AddCredentialMenu';
import { CredentialDialog } from './CredentialDialog';
import { CredentialKindFilter } from './CredentialKindFilter';
import { CredentialRow } from './CredentialRow';
import { PageSelect, PageToolbar, PageToolbarSpacer } from '@/components/layout/PageToolbar';
import { AccessAuditDialog } from '@/features/access/AccessAuditDialog';
import { CloneDialog } from '@/features/access/CloneDialog';
import { McpOAuthDialog } from '@/features/access/McpOAuthDialog';
import { GrantsDialog } from '@/features/access/GrantsDialog';
import { CREDENTIAL_KINDS } from '../../utils/credentialForm';
import { useTestDecisionConnection } from '@/features/browser-lab/services/browserTask.service';
import { AccessLoginsSection } from '@/features/access/logins/AccessLoginsSection';
import { useAccessLoginsQuery } from '@/services/accessLogins.service';

type Open =
  | { dialog: 'edit'; entry: CredentialEntry }
  | { dialog: 'new'; kind: CredentialKind }
  | { dialog: 'mcp' }
  | { dialog: 'grants' | 'audit' | 'delete' | 'clone' | 'signIn'; entry: CredentialEntry };

// The Credentials page: the team's website logins, API keys, SSH keys and secrets. Its
// owners and managers add, change and grant them; a member whose role reads the team's
// integrations sees them.
// In the access center the area's tabs lead the header row (`leading`) and the kinds
// become a select.
export default function TeamCredentialsSection({
  teamId,
  leading,
}: {
  teamId: number;
  leading?: ReactNode;
}) {
  const t = useTranslations('credentials');
  const tAccess = useTranslations('access');
  const { data: team } = useTeamQuery(teamId);
  const canRead = team?.permissions.integrations.read ?? false;
  const canManage = team?.role === 'owner' || team?.role === 'manager';
  const [kind, setKind] = useState<ListedKind | undefined>();
  const paging = usePaging();
  const page = useCredentialsPageQuery(teamId, paging.params, kind);
  const deleteCredential = useDeleteCredential(teamId);
  const testConnection = useTestDecisionConnection(teamId);
  const [open, setOpen] = useState<Open | null>(null);
  const close = () => setOpen(null);
  // Every login the agents use ("Anmeldungen") leads the page, with all kinds or the
  // runtime logins shown; the stored credentials follow under a title of their own.
  const showLogins = canRead && (kind === undefined || kind === 'runtime_login');
  const logins = useAccessLoginsQuery(teamId, showLogins);
  const hasLogins =
    showLogins &&
    !!logins.data &&
    logins.data.agents.length + (logins.data.shared?.length ?? 0) > 0;

  return (
    <SectionPageView title={t('title')} wide>
      <PageToolbar>
        {leading}
        {canRead && !leading && (
          <CredentialKindFilter
            value={kind === 'mcp_oauth' ? undefined : kind}
            onChange={(next) => {
              setKind(next);
              paging.reset();
            }}
          />
        )}
        {canRead && leading && (
          <PageSelect
            label={t('all')}
            icon={ListFilter}
            value={kind ?? 'all'}
            defaultValue="all"
            onChange={(next) => {
              setKind(next === 'all' ? undefined : (next as ListedKind));
              paging.reset();
            }}
            options={[
              { value: 'all', label: t('all') },
              ...CREDENTIAL_KINDS.map((value) => ({ value, label: t(`kindsPlural.${value}`) })),
              { value: 'mcp_oauth', label: tAccess('mcp.kindPlural') },
            ]}
          />
        )}
        <PageToolbarSpacer />
        {canManage && (
          <AddCredentialMenu
            onSelect={(next) =>
              setOpen(next === 'mcp_oauth' ? { dialog: 'mcp' } : { dialog: 'new', kind: next })
            }
          />
        )}
      </PageToolbar>
      {!team ? (
        <ListSkeleton rows={3} rowClassName="h-14" />
      ) : !canRead ? (
        <p className="text-sm text-muted-foreground">{t('noAccess')}</p>
      ) : (
        <div className="flex flex-1 flex-col gap-4">
          {showLogins && (
            <AccessLoginsSection
              teamId={teamId}
              canManage={canManage}
              onAddRuntimeLogin={
                canManage ? () => setOpen({ dialog: 'new', kind: 'runtime_login' }) : undefined
              }
            />
          )}
          {hasLogins && <h2 className="-mb-2 text-md font-medium">{t('logins.storedTitle')}</h2>}
          {!page.data ? (
            <ListSkeleton rows={3} rowClassName="h-14" />
          ) : page.data.total === 0 ? (
            <EmptyState title={t('empty')} description={t('emptyHint')} />
          ) : (
            <>
              <Card as="ul" pad="none" className="divide-y overflow-hidden">
                {page.data.items.map((entry) => (
                  <CredentialRow
                    key={entry.id}
                    entry={entry}
                    canManage={canManage}
                    onOpen={(dialog) =>
                      dialog === 'test'
                        ? testConnection.mutate(entry.id)
                        : setOpen({ dialog, entry })
                    }
                  />
                ))}
              </Card>
              <ListPager paging={paging} total={page.data.total} />
            </>
          )}
        </div>
      )}

      {open?.dialog === 'new' && (
        <CredentialDialog teamId={teamId} kind={open.kind} entry={null} onClose={close} />
      )}
      {open?.dialog === 'mcp' && <McpOAuthDialog teamId={teamId} onClose={close} />}
      {open?.dialog === 'signIn' && (
        <McpOAuthDialog
          teamId={teamId}
          again={{ id: open.entry.id, label: open.entry.label }}
          onClose={close}
        />
      )}
      {open?.dialog === 'edit' && open.entry.kind !== 'mcp_oauth' && (
        <CredentialDialog
          teamId={teamId}
          kind={open.entry.kind as CredentialKind}
          entry={open.entry}
          onClose={close}
        />
      )}
      {open?.dialog === 'grants' && (
        <GrantsDialog
          teamId={teamId}
          target={{
            id: open.entry.id,
            label: open.entry.label,
            projectId: open.entry.projectId,
            grants: open.entry.grants,
            runtime: open.entry.kind === 'runtime_login' ? open.entry.runtime : null,
          }}
          services={[]}
          onClose={close}
        />
      )}
      {open?.dialog === 'audit' && (
        <AccessAuditDialog
          teamId={teamId}
          credentialId={open.entry.id}
          name={open.entry.label}
          onClose={close}
        />
      )}
      {open?.dialog === 'clone' && (
        <CloneDialog teamId={teamId} entry={open.entry} onClose={close} />
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
