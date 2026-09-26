'use client';

import { useTranslations } from 'next-intl';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useReceiptQuery } from '../services/receipts.service';
import { receiptFormOf } from '../utils/form';
import ReceiptBody from './ReceiptBody';

export function ReceiptSheet({
  projectKey,
  receiptId,
  onClose,
}: {
  projectKey: string;
  receiptId: number | null;
  onClose: () => void;
}) {
  const t = useTranslations('receipts');
  const query = useReceiptQuery(projectKey, receiptId);
  const receipt = query.data;
  return (
    <Sheet open={receiptId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-sidebar-border px-4 py-3 pe-12">
          <SheetTitle className="truncate text-md">
            {receipt ? (receipt.issuer ?? receipt.filename) : t('detail.title')}
          </SheetTitle>
        </SheetHeader>
        {receipt ? (
          <ReceiptBody
            // A new version of the receipt (saved, read again, matched) starts the form over.
            key={`${receipt.id}:${receipt.status}:${JSON.stringify(receiptFormOf(receipt))}`}
            projectKey={projectKey}
            receipt={receipt}
            onDeleted={onClose}
          />
        ) : (
          <p className="p-4 text-sm text-muted-foreground">{t('detail.loading')}</p>
        )}
      </SheetContent>
    </Sheet>
  );
}
