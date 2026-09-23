import { useQuery } from '@tanstack/react-query';
import { getBrowserGatewayOverview } from '@/lib/api/endpoints/browserGateway';
import { qk } from '@/services/queryKeys';

// Home's "Browser" overview: every project that could have a project browser. No live
// state yet (see ProjectBrowserTile.tsx) — a follow-up once the browser router's HTTP
// surface exists can add a short poll here for the current URL/control/thumbnail.
export function useBrowserGatewayOverviewQuery() {
  return useQuery({
    queryKey: qk.browserGatewayOverview(),
    queryFn: () => getBrowserGatewayOverview(),
  });
}
