import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getConnections, runConnectionAction } from '@/lib/api/endpoints/connections';

const keys = { connections: ['connections'] as const };

export function useConnectionsQuery() {
  return useQuery({ queryKey: keys.connections, queryFn: getConnections, refetchInterval: 60_000 });
}

export function useConnectionAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'probe' | 'reconnect' }) =>
      runConnectionAction(id, action),
    onSuccess: (data) => client.setQueryData(keys.connections, data),
  });
}
