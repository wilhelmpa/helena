// The team's MCP server library, and the servers enabled on one of its agents. Both
// belong to the team, so every hook here is keyed by it.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import {
  type McpServerInput,
  createMcpServer,
  deleteMcpServer,
  listAgentMcpServers,
  listMcpServers,
  setAgentMcpServers,
  updateMcpServer,
} from '@/lib/api/endpoints/agentMcpServers';
import { qk } from '@/services/queryKeys';

export function useMcpServersQuery(teamId: number | null) {
  return useQuery({
    queryKey: qk.mcpServers(teamId ?? 0),
    queryFn: () => listMcpServers(teamId!),
    enabled: teamId != null,
  });
}

function useLibraryInvalidator(teamId: number) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: qk.mcpServers(teamId) });
    // The team list counts the servers with its tools, and an agent lists the ones it has.
    void qc.invalidateQueries({ queryKey: qk.teams });
    void qc.invalidateQueries({ queryKey: qk.teamAiAgents(teamId) });
  };
}

// The new server appears in the list, so a success needs no toast.
export function useCreateMcpServer(teamId: number) {
  const invalidate = useLibraryInvalidator(teamId);
  return useMutation({
    mutationFn: (input: McpServerInput) => createMcpServer(teamId, input),
    onSuccess: invalidate,
  });
}

// The list shows neither the values nor the secrets a change may touch, so it is confirmed.
export function useUpdateMcpServer(teamId: number) {
  const t = useTranslations('teams.mcpServers');
  const invalidate = useLibraryInvalidator(teamId);
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: McpServerInput }) =>
      updateMcpServer(teamId, id, input),
    onSuccess: (server) => {
      toast.success(t('saved', { name: server.name }));
      invalidate();
    },
  });
}

export function useDeleteMcpServer(teamId: number) {
  const invalidate = useLibraryInvalidator(teamId);
  return useMutation({
    mutationFn: (id: number) => deleteMcpServer(teamId, id),
    onSuccess: invalidate,
  });
}

export function useAgentMcpServersQuery(teamId: number | null, agentId: number | null) {
  return useQuery({
    queryKey: qk.agentMcpServers(teamId ?? 0, agentId ?? 0),
    queryFn: () => listAgentMcpServers(teamId!, agentId!),
    enabled: teamId != null && agentId != null,
  });
}

export function useSetAgentMcpServers(teamId: number | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, mcpServerIds }: { agentId: number; mcpServerIds: number[] }) =>
      setAgentMcpServers(teamId!, agentId, mcpServerIds),
    onSuccess: (_data, { agentId }) => {
      if (teamId != null)
        void qc.invalidateQueries({ queryKey: qk.agentMcpServers(teamId, agentId) });
    },
  });
}
