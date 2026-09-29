'use client';

import { useOverlayShownByPage, usePinnedOverlay, pinOverlay } from '@/utils/overlayPin';
import ReceiptOverlay from './ReceiptOverlay';

// A receipt pinned in the overlay stays open on every other page (Auftrag 117).
export default function PinnedReceiptOverlay() {
  const pin = usePinnedOverlay('receipt');
  const shownByPage = useOverlayShownByPage(pin);
  if (!pin || shownByPage) return null;
  const [projectKey, idText] = pin.value.split(':');
  const receiptId = Number(idText);
  if (!projectKey || !receiptId) return null;
  return (
    <ReceiptOverlay
      projectKey={projectKey}
      receiptId={receiptId}
      pinnedHost
      onClose={() => undefined}
      // A receipt it links to takes its place, pinned as well.
      onOpenReceipt={(id) => pinOverlay({ kind: 'receipt', value: `${projectKey}:${id}` })}
    />
  );
}
