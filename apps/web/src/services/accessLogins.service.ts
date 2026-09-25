// "Anmeldungen" in Zugänge: the agents' logins and the shared ones, "Prüfen" and
// "Abmelden".

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import {
  type AccessLogins,
  type AgentLogin,
  checkAgentLogin,
  listAccessLogins,
  signOutAgentLogin,
} from '@/lib/api/endpoints/accessLogins';
import { qk } from '@/services/queryKeys';

// The runners look at their runtime's login every few minutes; a minute here is enough.
const REFRESH_MS = 60_000;

export function useAccessLoginsQuery(teamId: number, enabled = true) {
  return useQuery({
    queryKey: qk.accessLogins(teamId),
    queryFn: () => listAccessLogins(teamId),
    enabled,
    refetchInterval: REFRESH_MS,
  });
}

// Puts the answered row into the list, and reloads what shows the agent's runtime state.
function useRowUpdate(teamId: number) {
  const qc = useQueryClient();
  return (row: AgentLogin) => {
    qc.setQueryData<AccessLogins>(qk.accessLogins(teamId), (current) =>
      current
        ? {
            ...current,
            agents: current.agents.map((agent) => (agent.agentId === row.agentId ? row : agent)),
          }
        : current,
    );
    void qc.invalidateQueries({ queryKey: qk.agentRuntimeSync(teamId, row.agentId) });
  };
}

export function useCheckAgentLogin(teamId: number) {
  const t = useTranslations('credentials.logins');
  const update = useRowUpdate(teamId);
  return useMutation({
    mutationFn: (agentId: number) => checkAgentLogin(teamId, agentId),
    onSuccess: (row) => {
      update(row);
      toast.success(t('checked', { name: row.name }));
    },
  });
}

export function useSignOutAgentLogin(teamId: number) {
  const t = useTranslations('credentials.logins');
  const qc = useQueryClient();
  const update = useRowUpdate(teamId);
  return useMutation({
    mutationFn: (agentId: number) => signOutAgentLogin(teamId, agentId),
    onSuccess: (row) => {
      update(row);
      // The access log has a new entry.
      void qc.invalidateQueries({ queryKey: qk.access(teamId) });
      toast.success(t('signedOut', { name: row.name }));
    },
  });
}
