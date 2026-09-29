import { useQuery } from '@tanstack/react-query';
import { useShell } from '@/context/shellContext';
import {
  getTradingWidgets,
  type TradingPeriod,
  type TradingWidgetId,
  type TradingWidgetResult,
  type TradingWidgetDataMap,
} from '@/lib/api/endpoints/trading';
import { useIntegrationOptionsQuery } from '@/services/integrations.service';
import { problemOfMessage, problemOfRequest, type TradingProblem } from '../utils/tradingErrors';

// All six trading widgets come from ONE request; every widget of a dashboard reads the same
// cached answer, so six cards are one call (the API caches it for 15 s as well). The numbers
// are refreshed every 30 s while the page is open and shown.
export function useTradingWidgets(
  projectKey: string,
  period: TradingPeriod,
  credentialId: number | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: ['trading-widgets', projectKey, period, credentialId ?? null],
    queryFn: () => getTradingWidgets(projectKey, period, credentialId),
    staleTime: 15_000,
    refetchInterval: 30_000,
    enabled,
  });
}

export type TradingWidgetState<K extends TradingWidgetId> =
  | { status: 'loading' }
  | { status: 'problem'; problem: TradingProblem }
  | { status: 'ready'; data: TradingWidgetDataMap[K] };

export function useTradingWidget<K extends TradingWidgetId>(
  id: K,
  projectKey: string,
  period: TradingPeriod,
  credentialId: number | undefined,
) {
  const query = useTradingWidgets(projectKey, period, credentialId);
  const result = query.data?.[id] as TradingWidgetResult<TradingWidgetDataMap[K]> | undefined;
  let state: TradingWidgetState<K>;
  if (query.isError && !query.data) {
    state = { status: 'problem', problem: problemOfRequest(query.error) };
  } else if (!result) {
    state = { status: 'loading' };
  } else if (result.error) {
    state = { status: 'problem', problem: problemOfMessage(result.error) };
  } else if (result.data == null) {
    state = { status: 'problem', problem: { kind: 'generic' } };
  } else {
    state = { status: 'ready', data: result.data };
  }
  return {
    state,
    updatedAt: query.dataUpdatedAt ? new Date(query.dataUpdatedAt).toISOString() : null,
    refetch: () => void query.refetch(),
    refetching: query.isFetching,
  };
}

// The Alpaca paper connections the team has stored (Werkzeuge → Alpaca Paper). Only their
// names: keys and limits never leave the API.
export function usePaperConnections() {
  const { project } = useShell();
  const options = useIntegrationOptionsQuery(project?.project.teamId ?? null, 'tool');
  return {
    connections: (options.data ?? [])
      .filter((option) => option.integrationKey === 'alpaca_paper')
      .map((option) => ({ id: option.id, label: option.label ?? `#${option.id}` })),
    loading: options.isLoading,
  };
}
