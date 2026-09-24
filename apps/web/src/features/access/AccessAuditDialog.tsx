'use client';

import { useTranslations } from 'next-intl';
import Modal from '@/components/common/overlay/Modal';
import ListPager from '@/components/common/ListPager';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import { usePaging } from '@/hooks/usePaging';
import { useAuditQuery } from '@/services/access.service';
import { AuditRow } from './AuditRow';

// The audit log of one credential or connector account.
export function AccessAuditDialog({
  teamId,
  credentialId,
  name,
  onClose,
}: {
  teamId: number;
  credentialId: number;
  name: string;
  onClose: () => void;
}) {
  const t = useTranslations('credentials');
  const tLog = useTranslations('access.log');
  const paging = usePaging();
  const audit = useAuditQuery(teamId, paging.params, { credentialId }).data;

  return (
    <Modal title={t('auditTitle', { name })} onClose={onClose} wide>
      {!audit ? (
        <ListSkeleton rows={4} rowClassName="h-10" />
      ) : audit.total === 0 ? (
        <p className="text-sm text-muted-foreground">{tLog('empty')}</p>
      ) : (
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
          <ul className="divide-y">
            {audit.items.map((entry) => (
              <AuditRow key={entry.id} entry={entry} showCredential={false} />
            ))}
          </ul>
          <ListPager paging={paging} total={audit.total} />
        </div>
      )}
    </Modal>
  );
}
