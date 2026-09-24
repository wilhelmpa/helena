import { useQuery } from '@tanstack/react-query';
import { getBrowserGatewayOverview } from '@/lib/api/endpoints/browserGateway';
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
