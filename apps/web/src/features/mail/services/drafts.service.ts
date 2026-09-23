import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  attachVaultFileToDraft,
  deleteMailDraft,
  getMailDraft,
  listMailDrafts,
  searchMailContacts,
  sendMailDraft,
  undoMailDraft,
  updateMailDraft,
  uploadMailDraftFile,
  type MailDraft,
  type MailDraftPatch,
} from '@/lib/api/endpoints/mail';
import { qk } from '@/services/queryKeys';

export function useMailContacts(teamId: number, q: string) {
  return useQuery({
    queryKey: ['mail', teamId, 'contacts', q],
    queryFn: () => searchMailContacts(teamId, q),
    enabled: q.trim().length >= 2,
    staleTime: 60_000,
  });
}

export function useMailDrafts(teamId: number | null) {
  return useQuery({
    queryKey: qk.mailDrafts(teamId ?? 0),
    queryFn: () => listMailDrafts(teamId!),
    enabled: teamId != null,
  });
}

export function useMailDraft(draftId: number) {
  return useQuery({ queryKey: qk.mailDraft(draftId), queryFn: () => getMailDraft(draftId) });
}

function useDraftResult() {
  const client = useQueryClient();
  return (draft: MailDraft) => {
    client.setQueryData(qk.mailDraft(draft.id), draft);
    void client.invalidateQueries({ queryKey: qk.mailDrafts(draft.teamId) });
  };
}

export function useSaveDraft(draftId: number) {
  const onSaved = useDraftResult();
  return useMutation({
    mutationFn: (patch: MailDraftPatch) => updateMailDraft(draftId, patch),
    onSuccess: onSaved,
  });
}

export function useDraftFile(draftId: number) {
  const onSaved = useDraftResult();
  return useMutation({
    mutationFn: (input: { file: File } | { vaultPath: string }) =>
      'file' in input
        ? uploadMailDraftFile(draftId, input.file)
        : attachVaultFileToDraft(draftId, input.vaultPath),
    onSuccess: onSaved,
  });
}

export function useSendDraft() {
  const onSaved = useDraftResult();
  return useMutation({
    mutationFn: (draftId: number) => sendMailDraft(draftId),
    onSuccess: onSaved,
  });
}

export function useUndoDraft() {
  const onSaved = useDraftResult();
  return useMutation({
    mutationFn: (draftId: number) => undoMailDraft(draftId),
    onSuccess: onSaved,
  });
}

export function useDiscardDraft(teamId: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (draftId: number) => deleteMailDraft(draftId),
    onSuccess: () => client.invalidateQueries({ queryKey: qk.mailDrafts(teamId) }),
  });
}
