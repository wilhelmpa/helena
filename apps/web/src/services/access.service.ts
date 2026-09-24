// The access center: Google accounts, grants, the audit log and clone jobs.

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PageParams } from '@/lib/api/core/paging';
import {
  adoptGogAccount,
  checkGoogleAccount,
  deleteGoogleAccount,
  deleteGoogleClient,
  finishGoogleSignIn,
  finishMcpSignIn,
  getGogStatus,
  getGoogle,
  importGoogleClient,
  listAudit,
  setGrants,
  startClone,
  startGoogleSignIn,
  startMcpSignIn,
  updateGoogleAccount,
  type AuditAction,
  type CloneInput,
  type GoogleEngine,
  type GoogleService,
  type GrantInput,
  type SignInInput,
} from '@/lib/api/endpoints/access';
import { qk } from '@/services/queryKeys';

export function useGoogleQuery(teamId: number) {
  return useQuery({ queryKey: qk.accessGoogle(teamId), queryFn: () => getGoogle(teamId) });
}

export function useGogStatusQuery(teamId: number, enabled: boolean) {
  return useQuery({
    queryKey: [...qk.accessGoogle(teamId), 'gog'],
    queryFn: () => getGogStatus(teamId),
    enabled,
  });
}

export function useAuditQuery(
  teamId: number,
  params: PageParams,
  filter: { credentialId?: number; action?: AuditAction },
) {
  return useQuery({
    queryKey: qk.accessAudit(teamId, params, filter),
    queryFn: () => listAudit(teamId, params, filter),
    placeholderData: keepPreviousData,
  });
}

// Every access center change refreshes the Google list, the credentials, the mail
// accounts (a Mail service is a mailbox) and the audit log.
function useInvalidate(teamId: number) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: qk.access(teamId) });
    void qc.invalidateQueries({ queryKey: qk.credentials(teamId) });
    void qc.invalidateQueries({ queryKey: qk.mail(teamId) });
  };
}

export function useSetGrants(teamId: number) {
  const invalidate = useInvalidate(teamId);
  return useMutation({
    mutationFn: ({ id, grants }: { id: number; grants: GrantInput[] }) =>
      setGrants(teamId, id, grants),
    onSuccess: invalidate,
  });
}

export function useImportGoogleClient(teamId: number) {
  const invalidate = useInvalidate(teamId);
  return useMutation({
    mutationFn: (input: { json: string; label?: string; engine?: GoogleEngine }) =>
      importGoogleClient(teamId, input),
    onSuccess: invalidate,
  });
}

export function useDeleteGoogleClient(teamId: number) {
  const invalidate = useInvalidate(teamId);
  return useMutation({
    mutationFn: (id: number) => deleteGoogleClient(teamId, id),
    onSuccess: invalidate,
  });
}

export function useStartGoogleSignIn(teamId: number) {
  return useMutation({ mutationFn: (input: SignInInput) => startGoogleSignIn(teamId, input) });
}

export function useFinishGoogleSignIn(teamId: number) {
  const invalidate = useInvalidate(teamId);
  return useMutation({
    mutationFn: (input: { sessionId: string; redirectUrl: string }) =>
      finishGoogleSignIn(teamId, input),
    onSuccess: invalidate,
  });
}

export function useUpdateGoogleAccount(teamId: number) {
  const invalidate = useInvalidate(teamId);
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: number;
      input: { label?: string; projectId?: number | null; services?: GoogleService[] };
    }) => updateGoogleAccount(teamId, id, input),
    onSuccess: invalidate,
  });
}

export function useCheckGoogleAccount(teamId: number) {
  const invalidate = useInvalidate(teamId);
  return useMutation({
    mutationFn: (id: number) => checkGoogleAccount(teamId, id),
    onSuccess: invalidate,
  });
}

export function useDeleteGoogleAccount(teamId: number) {
  const invalidate = useInvalidate(teamId);
  return useMutation({
    mutationFn: ({ id, fromGog }: { id: number; fromGog: boolean }) =>
      deleteGoogleAccount(teamId, id, fromGog),
    onSuccess: invalidate,
  });
}

export function useAdoptGogAccount(teamId: number) {
  const invalidate = useInvalidate(teamId);
  return useMutation({
    mutationFn: (input: { email: string; projectId?: number | null }) =>
      adoptGogAccount(teamId, input),
    onSuccess: invalidate,
  });
}

export function useStartMcpSignIn(teamId: number) {
  return useMutation({
    mutationFn: (
      input: { id: number } | { label?: string; serverUrl: string; scope?: string | null },
    ) => startMcpSignIn(teamId, input),
  });
}

export function useFinishMcpSignIn(teamId: number) {
  const invalidate = useInvalidate(teamId);
  return useMutation({
    mutationFn: ({ id, redirectUrl }: { id: number; redirectUrl: string }) =>
      finishMcpSignIn(teamId, id, redirectUrl),
    onSuccess: invalidate,
  });
}

export function useStartClone(teamId: number) {
  const invalidate = useInvalidate(teamId);
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: CloneInput }) => startClone(teamId, id, input),
    onSuccess: invalidate,
  });
}
