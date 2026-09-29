'use client';

import { useRouter } from 'next/navigation';
import { useOverlayShownByPage, usePinnedOverlay } from '@/utils/overlayPin';
import { vaultNotePath } from '@/utils/paths';
import type { FilePermissions } from './FileBrowser';
import type { KnowledgeEntry } from './KnowledgeListView';
import KnowledgePreview from './KnowledgePreview';

// A file of Wissen pinned in the overlay (Auftrag 117): on every other page it stays open
// on the right, until it is closed or unpinned. The Wissen page that shows it itself keeps
// its own; this one steps back there.
export default function PinnedKnowledgePreview() {
  const router = useRouter();
  const pin = usePinnedOverlay('file');
  const shownByPage = useOverlayShownByPage(pin);
  if (!pin?.data || shownByPage) return null;
  let parsed: { entry: KnowledgeEntry; can: FilePermissions } | null = null;
  try {
    parsed = JSON.parse(pin.data) as { entry: KnowledgeEntry; can: FilePermissions };
  } catch {
    return null;
  }
  const { entry, can } = parsed;
  return (
    <KnowledgePreview
      key={pin.value}
      entry={entry}
      can={can}
      pinnedHost
      onClose={() => undefined}
      onOpenLarge={() => {
        if (entry.vaultPath) router.push(vaultNotePath(entry.vaultPath));
      }}
    />
  );
}
