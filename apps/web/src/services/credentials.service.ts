// The team's credentials: web logins, API keys, SSH keys and secrets, the agents they
// are granted to, and their audit log.

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import type { PageParams } from '@/lib/api/core/paging';
import {
  type CredentialInput,
  type CredentialKind,
  type NewCredentialInput,
  createCredential,
  deleteCredential,
  listCredentialUses,
  listCredentials,
  regenerateSshKey,
  setCredentialGrants,
  updateCredential,
} from '@/lib/api/endpoints/credentials';
import { qk } from '@/services/queryKeys';

export function useCredentialsPageQuery(teamId: number, params: PageParams, kind?: CredentialKind) {
  return useQuery({
    queryKey: qk.credentialPage(teamId, params, kind),
    queryFn: () => listCredentials(teamId, params, kind),
    placeholderData: keepPreviousData,
  });
}

export function useCredentialUsesQuery(teamId: number, id: number, params: PageParams) {
  return useQuery({
    queryKey: qk.credentialUses(teamId, id, params),
    queryFn: () => listCredentialUses(teamId, id, params),
    placeholderData: keepPreviousData,
  });
}

function useInvalidator(teamId: number) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: qk.credentials(teamId) });
    // The MCP server form picks the team's secrets and API keys from the integration options.
    void qc.invalidateQueries({ queryKey: qk.integrations });
  };
}

// The new credential appears in the list, so a success needs no toast.
export function useCreateCredential(teamId: number) {
  const invalidate = useInvalidator(teamId);
  return useMutation({
    mutationFn: (input: NewCredentialInput) => createCredential(teamId, input),
    onSuccess: invalidate,
  });
}

// The list shows no secret field, so a replaced password is confirmed.
export function useUpdateCredential(teamId: number) {
  const t = useTranslations('credentials');
  const invalidate = useInvalidator(teamId);
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: CredentialInput }) =>
      updateCredential(teamId, id, input),
    onSuccess: (entry) => {
      toast.success(t('saved', { name: entry.label }));
      invalidate();
    },
  });
}

export function useDeleteCredential(teamId: number) {
  const invalidate = useInvalidator(teamId);
  return useMutation({
    mutationFn: (id: number) => deleteCredential(teamId, id),
    onSuccess: invalidate,
  });
}

export function useSetCredentialGrants(teamId: number) {
  const t = useTranslations('credentials');
  const invalidate = useInvalidator(teamId);
  return useMutation({
    mutationFn: ({ id, agentIds }: { id: number; agentIds: number[] }) =>
      setCredentialGrants(teamId, id, agentIds),
    onSuccess: (entry) => {
      toast.success(t('grantsSaved', { name: entry.label }));
      invalidate();
    },
  });
}

export function useRegenerateSshKey(teamId: number) {
  const t = useTranslations('credentials');
  const invalidate = useInvalidator(teamId);
  return useMutation({
    mutationFn: (id: number) => regenerateSshKey(teamId, id),
    onSuccess: () => {
      toast.success(t('ssh.regenerated'));
      invalidate();
    },
  });
}
