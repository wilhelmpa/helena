import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getRootAudit, getRootSettings, updateRootSettings } from '@/lib/api/endpoints/root-access';

export function useRootAccess() {
  const client = useQueryClient();
  const settings = useQuery({ queryKey: ['root-access'], queryFn: getRootSettings });
  const audit = useQuery({ queryKey: ['root-audit'], queryFn: getRootAudit });
  const update = useMutation({
    mutationFn: updateRootSettings,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['root-access'] });
      await client.invalidateQueries({ queryKey: ['root-audit'] });
    },
  });
  return { settings, audit, update };
}
