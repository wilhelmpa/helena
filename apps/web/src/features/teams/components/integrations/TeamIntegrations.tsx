import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ResourcePermissions } from '@/lib/api/endpoints/roles';
import type { IntegrationCredential, IntegrationMeta } from '@/lib/api/endpoints/integrations';
import { useCredentialsPageQuery, useDeleteCredential } from '@/services/integrations.service';
import { EmptyState } from '@/components/common/page/EmptyState';
import { integrationLabel } from '@/utils/integrationLabels';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import ListPager from '@/components/common/ListPager';
import { usePaging } from '@/hooks/usePaging';
import { CredentialDialog } from './CredentialDialog';
import { CredentialRow } from './CredentialRow';
import TableCard from '@/components/common/page/TableCard';
import { Table, Th, Tr } from '@/design-system';

// The team's stored credentials as a table. Editing happens in a dialog; deleting
// confirms first. Adding is done from the tab header.
export default function TeamIntegrations({
  teamId,
  catalog,
  permissions,
}: {
  teamId: number;
  catalog: IntegrationMeta[];
  permissions: ResourcePermissions;
}) {
  const t = useTranslations('teams.integrations');
  const tCommon = useTranslations('common');
  const [editing, setEditing] = useState<IntegrationCredential | null>(null);
  const [deleting, setDeleting] = useState<IntegrationCredential | null>(null);
  const paging = usePaging();

  const credentialsQuery = useCredentialsPageQuery(teamId, paging.params);
  const credentials = credentialsQuery.data?.items ?? [];
  const total = credentialsQuery.data?.total ?? 0;
  const deleteCredential = useDeleteCredential(teamId);

  return (
    <>
      {total === 0 ? (
        <EmptyState title={t('empty')} description={t('emptyHint')} />
      ) : (
        <div className="space-y-4">
          <div className="overflow-x-auto">
            <TableCard>
              <Table stack={false} className="table-fixed xl:min-w-[560px]">
                <colgroup>
                  <col className="w-[34%]" />
                  <col className="w-[50%]" />
                  <col className="w-[16%]" />
                </colgroup>
                <thead>
                  <Tr className="hover:bg-transparent">
                    <Th>{t('columns.integration')}</Th>
                    <Th>{t('columns.credentials')}</Th>
                    <Th alignment="end">{tCommon('actions')}</Th>
                  </Tr>
                </thead>
                <tbody>
                  {credentials.map((c) => (
                    <CredentialRow
                      key={c.id}
                      credential={c}
                      integrationLabel={integrationLabel(catalog, c.integrationKey)}
                      canEdit={permissions.edit}
                      canDelete={permissions.delete}
                      onEdit={() => setEditing(c)}
                      onDelete={() => setDeleting(c)}
                    />
                  ))}
                </tbody>
              </Table>
            </TableCard>
          </div>
          <ListPager paging={paging} total={total} />
        </div>
      )}

      {editing && (
        <CredentialDialog
          teamId={teamId}
          catalog={catalog}
          existing={editing}
          onClose={() => setEditing(null)}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={t('delete')}
          confirmLabel={t('delete')}
          onConfirm={async () => {
            await deleteCredential.mutateAsync(deleting.id);
            setDeleting(null);
          }}
          onClose={() => setDeleting(null)}
        >
          <div className="text-sm text-muted-foreground">
            {t('deleteMessage', {
              integration: integrationLabel(catalog, deleting.integrationKey),
            })}
          </div>
        </ConfirmDialog>
      )}
    </>
  );
}
