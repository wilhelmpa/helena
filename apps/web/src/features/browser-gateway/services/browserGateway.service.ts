import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getBrowserGatewayOverview } from '@/lib/api/endpoints/browserGateway';
import {
  getInstanceBrowserPowerSettings,
  updateInstanceBrowserPowerSettings,
  type BrowserPowerSettings,
} from '@/lib/api/endpoints/god';
import { qk } from '@/services/queryKeys';
import { browserRouterOverview } from '@/utils/browserOverview';

// The projects the caller works in, each with the slug of its project browser.
export function useBrowserGatewayOverviewQuery() {
  return useQuery({
    queryKey: qk.browserGatewayOverview(),
    queryFn: () => getBrowserGatewayOverview(),
  });
}

// The live state of every project browser, read again every 10 seconds while the page is
// open (and not at all while it is in the background).
export function useBrowserRouterOverviewQuery() {
  return useQuery({
    queryKey: ['browser-router-overview'],
    queryFn: () => browserRouterOverview(),
    refetchInterval: 10_000,
    retry: 1,
  });
}

// When project browsers run (Helena → Einstellungen → Browser; instance owner only).
export function useBrowserPowerSettingsQuery() {
  return useQuery({
    queryKey: qk.instanceBrowserPowerSettings,
    queryFn: () => getInstanceBrowserPowerSettings(),
  });
}

export function useUpdateBrowserPowerSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<BrowserPowerSettings>) => updateInstanceBrowserPowerSettings(patch),
    onSuccess: (data) => qc.setQueryData(qk.instanceBrowserPowerSettings, data),
  });
}
