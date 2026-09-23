import { useTranslations } from 'next-intl';
import type { CredentialEntry } from '@/lib/api/endpoints/credentials';
import Modal from '@/components/common/overlay/Modal';
import ListPager from '@/components/common/ListPager';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { usePaging } from '@/hooks/usePaging';
import { useCredentialUsesQuery } from '@/services/credentials.service';
import { CredentialUseRow } from './CredentialUseRow';

// Every time an agent's runner received the credential, and every login the agent filled
// with it.
export function CredentialAuditDialog({
  teamId,
  entry,
  onClose,
}: {
  teamId: number;
  entry: CredentialEntry;
  onClose: () => void;
}) {
  const t = useTranslations('credentials');
  const paging = usePaging();
  const uses = useCredentialUsesQuery(teamId, entry.id, paging.params).data;

  return (
    <Modal title={t('auditTitle', { name: entry.label })} onClose={onClose} wide>
      {!uses ? (
        <ListSkeleton rows={4} rowClassName="h-10" />
      ) : uses.total === 0 ? (
        <p className="text-sm text-muted-foreground">{t('auditEmpty')}</p>
      ) : (
        <div className="space-y-3">
          <ul className="divide-y">
            {uses.items.map((use) => (
              <CredentialUseRow key={use.id} use={use} />
            ))}
          </ul>
          <ListPager paging={paging} total={uses.total} />
        </div>
      )}
    </Modal>
  );
}
