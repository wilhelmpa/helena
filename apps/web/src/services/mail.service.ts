import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createMailAccount,
  createMailDraft,
  createMailRule,
  deleteMailAccount,
  deleteMailRule,
  listIssueMailThreads,
  listMailAccounts,
  listMailRules,
  listProjectMailAccounts,
  testMailConnection,
  updateMailAccount,
  type MailAccountInput,
} from '@/lib/api/endpoints/mail';
import { useOpenCompose } from '@/hooks/useMailCompose';
import { qk } from '@/services/queryKeys';

// The mail hooks more than one feature uses: the account settings (Home, a project,
// the credentials page), a task's Mails section, and starting a draft.

export function useMailAccounts(teamId: number | null) {
  return useQuery({
    queryKey: qk.mailAccounts(teamId ?? 0),
    queryFn: () => listMailAccounts(teamId!),
    enabled: teamId != null,
  });
}

export function useProjectMailAccounts(projectKey: string | undefined) {
  return useQuery({
    queryKey: qk.projectMailAccounts(projectKey ?? ''),
    queryFn: () => listProjectMailAccounts(projectKey!),
    enabled: !!projectKey,
  });
}

function useInvalidateMail(teamId: number) {
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: qk.mail(teamId) }),
      client.invalidateQueries({ queryKey: ['mail', 'project'] }),
    ]);
}

export function useSaveMailAccount(teamId: number) {
  const invalidate = useInvalidateMail(teamId);
  return useMutation({
    mutationFn: ({ id, input }: { id: number | null; input: Partial<MailAccountInput> }) =>
      id == null
        ? createMailAccount(teamId, input as MailAccountInput)
        : updateMailAccount(teamId, id, input),
    onSuccess: invalidate,
  });
}

export function useDeleteMailAccount(teamId: number) {
  const invalidate = useInvalidateMail(teamId);
  return useMutation({
    mutationFn: (accountId: number) => deleteMailAccount(teamId, accountId),
    onSuccess: invalidate,
  });
}

export function useTestMailConnection(teamId: number) {
  return useMutation({
    mutationFn: (input: Parameters<typeof testMailConnection>[1]) =>
      testMailConnection(teamId, input),
  });
}

export function useMailRules(teamId: number) {
  return useQuery({ queryKey: qk.mailRules(teamId), queryFn: () => listMailRules(teamId) });
}

export function useCreateMailRule(teamId: number) {
  const invalidate = useInvalidateMail(teamId);
  return useMutation({
    mutationFn: (input: Parameters<typeof createMailRule>[1]) => createMailRule(teamId, input),
    onSuccess: invalidate,
  });
}

export function useDeleteMailRule(teamId: number) {
  const invalidate = useInvalidateMail(teamId);
  return useMutation({
    mutationFn: (ruleId: number) => deleteMailRule(teamId, ruleId),
    onSuccess: invalidate,
  });
}

export function useIssueMailThreads(issueId: number) {
  return useQuery({
    queryKey: qk.issueMailThreads(issueId),
    queryFn: () => listIssueMailThreads(issueId),
  });
}

// Creates a draft (new, answer or forward) and shows it in the compose panel.
export function useStartDraft(teamId: number) {
  const client = useQueryClient();
  const openCompose = useOpenCompose();
  return useMutation({
    mutationFn: (input: Parameters<typeof createMailDraft>[1]) => createMailDraft(teamId, input),
    onSuccess: (draft) => {
      client.setQueryData(qk.mailDraft(draft.id), draft);
      void client.invalidateQueries({ queryKey: qk.mailDrafts(teamId) });
      openCompose(draft.id, true);
    },
  });
}
