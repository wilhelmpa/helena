import { useSyncExternalStore } from 'react';
import type { HeaderExtraStore } from '@/utils/headerExtraStore';
import { Separator } from '@/components/ui/separator';

// `bare`: rendered in the phone's page bar (see Shell) rather than after the header's
// breadcrumb, so it needs neither the hairline before it nor a spacer when empty.
export default function ShellHeaderExtra({
  store,
  bare = false,
}: {
  store: HeaderExtraStore;
  bare?: boolean;
}) {
  const node = useSyncExternalStore(store.subscribe, store.get, () => null);
  // Nothing to show takes no room: the page slot after it gets the whole middle.
  if (!node) return null;
  if (bare) return <div className="flex min-w-0 flex-1 items-center overflow-x-auto">{node}</div>;
  return (
    <>
      <Separator orientation="vertical" className="mx-1 h-4" />
      <div className="min-w-0 flex-1 overflow-x-auto">{node}</div>
    </>
  );
}
