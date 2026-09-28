import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  browserAction,
  browserTabs,
  browserTabsQueryKey,
  type BrowserAction,
} from '@/utils/browserControl';

// How often the tab list is read while the toolbar is shown, so an agent's navigation
// shows up in the address field. The live view also refreshes it when the tab changes.
const TABS_REFRESH_MS = 10_000;

export function useBrowserControl(base: string) {
  const queryClient = useQueryClient();
  const queryKey = browserTabsQueryKey(base);
  const tabs = useQuery({
    queryKey,
    queryFn: () => browserTabs(base),
    refetchInterval: TABS_REFRESH_MS,
    enabled: !!base,
  });
  const act = useMutation({
    mutationFn: ({ action, id, url }: { action: BrowserAction; id?: string; url?: string }) =>
      browserAction(base, action, { id, url }),
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });
  const list = tabs.data ?? [];
  return {
    tabs: list,
    ready: tabs.isSuccess,
    active: list.find((tab) => tab.active) ?? list[0] ?? null,
    act: act.mutate,
    busy: act.isPending,
  };
}
