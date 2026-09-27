import { usePageToolbarRoom } from '@/components/layout/PageToolbar';
import type { MruEntry } from '../hooks/useNoteBoardMru';
import NoteBoardTab from './NoteBoardTab';

// The board tabs. When the row runs out of room only the open board keeps its tab
// (with its menu); the switcher next to it reaches the others.
export default function NoteBoardTabs({
  tabs,
  activeBoardId,
  onSelect,
  onRename,
  onDelete,
}: {
  tabs: MruEntry[];
  activeBoardId: number | null;
  onSelect: (id: number) => void;
  onRename: (tab: MruEntry) => void;
  onDelete: (id: number) => void;
}) {
  const room = usePageToolbarRoom();
  const shown = room.tabs ? tabs : tabs.filter((tab) => tab.id === activeBoardId);
  return (
    <div className="flex min-w-0 shrink-0 items-center gap-0.5">
      {shown.map((tab) => (
        <NoteBoardTab
          key={tab.id}
          tab={tab}
          active={activeBoardId === tab.id}
          onSelect={() => onSelect(tab.id)}
          onRename={() => onRename(tab)}
          onDelete={() => onDelete(tab.id)}
        />
      ))}
    </div>
  );
}
