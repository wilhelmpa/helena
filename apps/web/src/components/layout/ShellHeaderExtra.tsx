import { useSyncExternalStore } from 'react';
import type { HeaderExtraStore } from '@/utils/headerExtraStore';
import { Separator } from '@/components/ui/separator';

export default function ShellHeaderExtra({ store }: { store: HeaderExtraStore }) {
  const node = useSyncExternalStore(store.subscribe, store.get, () => null);
  if (!node) return <div className="min-w-0 flex-1" />;
  return (
    <>
      <Separator orientation="vertical" className="mx-1 h-4" />
      <div className="min-w-0 flex-1 overflow-x-auto">{node}</div>
    </>
  );
}
