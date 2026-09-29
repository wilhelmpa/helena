'use client';

import { useTranslations } from 'next-intl';
import { Overlay } from '@/design-system';
import { useOverlayShownHere, type OverlayPin } from '@/utils/overlayPin';
import ReceiptPreview from './ReceiptPreview';

// A receipt in the one overlay on the right: from the Belege page, or pinned (Auftrag 117)
// on any other page by the Shell (PinnedReceiptOverlay).
export default function ReceiptOverlay({
  projectKey,
  receiptId,
  onClose,
  onOpenReceipt,
  pinnedHost = false,
}: {
  projectKey: string;
  receiptId: number;
  onClose: () => void;
  onOpenReceipt: (id: number) => void;
  pinnedHost?: boolean;
}) {
  const t = useTranslations('receipts');
  const pin: OverlayPin = { kind: 'receipt', value: `${projectKey}:${receiptId}` };
  useOverlayShownHere(pinnedHost ? null : pin);
  return (
    <Overlay
      label={t('detail.title')}
      tabs={[{ id: 'receipt', label: t('detail.title') }]}
      onClose={onClose}
      pin={pin}
      className="ds-receipt-overlay"
    >
      <ReceiptPreview
        key={receiptId}
        projectKey={projectKey}
        receiptId={receiptId}
        onOpenReceipt={onOpenReceipt}
        onDeleted={onClose}
      />
    </Overlay>
  );
}
