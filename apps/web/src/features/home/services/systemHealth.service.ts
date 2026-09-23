import { useQuery } from '@tanstack/react-query';
import { getSystemHealth } from '@/lib/api/endpoints/god';
import { qk } from '@/services/queryKeys';

export function useSystemHealthQuery(enabled: boolean) {
  return useQuery({ queryKey: qk.systemHealth, queryFn: getSystemHealth, enabled });
}
