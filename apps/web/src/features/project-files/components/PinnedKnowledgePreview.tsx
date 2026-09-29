'use client';

import { useRouter } from 'next/navigation';
import { useOverlayShownByPage, usePinnedOverlay } from '@/utils/overlayPin';
import { vaultNotePath } from '@/utils/paths';
import { EntryActionBar } from './FileActionBar';
import type { FilePermissions } from './FileBrowser';
import type { KnowledgeEntry } from './KnowledgeListView';
import KnowledgePreview from './KnowledgePreview';

// A file of Wissen pinned in the overlay (Auftrag 117): on every other page it stays open
// on the right, until it is closed or unpinned. The Wissen page that shows it itself keeps
// its own; this one steps back there.
export default function PinnedKnowledgePreview() {
  const pin = usePinnedOverlay('file');
  const shownByPage = useOverlayShownByPage(pin);
  if (!pin?.data || shownByPage) return null;
  let parsed: { entry: KnowledgeEntry; can: FilePermissions } | null = null;
  try {
    parsed = JSON.parse(pin.data) as { entry: KnowledgeEntry; can: FilePermissions };
  } catch {
    return null;
  }
  return <PinnedPreview key={pin.value} entry={parsed.entry} can={parsed.can} />;
}

function PinnedPreview({ entry, can }: { entry: KnowledgeEntry; can: FilePermissions }) {
  const router = useRouter();
  // On another page there are no dialogs to rename, move or trash with: the file's actions
  // that need none (download, link, chat) stand there all the same.
  return (
    <KnowledgePreview
      entry={entry}
      can={can}
      actionBar={<EntryActionBar entry={entry} can={can} />}
      pinnedHost
      onClose={() => undefined}
      onOpenLarge={() => {
        if (entry.vaultPath) router.push(vaultNotePath(entry.vaultPath));
      }}
    />
  );
}
