import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import {
  createTaskFromMail,
  getMailThread,
  listMailFolders,
  listMailThreads,
  mailThreadAction,
  moveMailThread,
  saveMailNote,
  setRemoteImages,
  type MailThreadAction,
  type MailThreadFilters,
  type MailThreadPage,
} from '@/lib/api/endpoints/mail';
import { qk } from '@/services/queryKeys';

export function useMailThreads(teamId: number, filters: MailThreadFilters) {
  return useInfiniteQuery({
    queryKey: qk.mailThreads(teamId, filters),
    queryFn: ({ pageParam }) => listMailThreads(teamId, filters, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
  });
}

export function useMailThread(threadId: number | null) {
  return useQuery({
    queryKey: qk.mailThread(threadId ?? 0),
    queryFn: () => getMailThread(threadId!),
    enabled: threadId != null,
  });
}

export function useMailFolders(teamId: number, accountId?: number) {
  return useQuery({
    queryKey: qk.mailFolders(teamId, accountId),
    queryFn: () => listMailFolders(teamId, accountId),
    enabled: accountId != null,
  });
}

function useInvalidateThreads(teamId: number) {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: qk.mail(teamId) });
}

// Marks the thread in the list at once, so j/k/e/u feel instant; the list is
// refetched afterwards.
export function useThreadAction(teamId: number) {
  const client = useQueryClient();
  const invalidate = useInvalidateThreads(teamId);
  return useMutation({
    mutationFn: ({ threadId, action }: { threadId: number; action: MailThreadAction }) =>
      mailThreadAction(threadId, action),
    onMutate: ({ threadId, action }) => {
      client.setQueriesData<InfiniteData<MailThreadPage>>(
        { queryKey: [...qk.mail(teamId), 'threads'] },
        (data) =>
          data && {
            ...data,
            pages: data.pages.map((page) => ({
              ...page,
              items:
                action === 'archive' || action === 'trash'
                  ? page.items.filter((row) => row.id !== threadId)
                  : page.items.map((row) =>
                      row.id !== threadId
                        ? row
                        : {
                            ...row,
                            unread:
                              action === 'unread' ? true : action === 'read' ? false : row.unread,
                            flagged:
                              action === 'flag' ? true : action === 'unflag' ? false : row.flagged,
                          },
                    ),
            })),
          },
      );
    },
    onSettled: (_data, _error, { threadId }) => {
      void invalidate();
      void client.invalidateQueries({ queryKey: qk.mailThread(threadId) });
    },
  });
}

export function useMoveThread() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ threadId, projectId }: { threadId: number; projectId: number | null }) =>
      moveMailThread(threadId, projectId),
    onSuccess: () => client.invalidateQueries({ queryKey: ['mail'] }),
  });
}

export function useCreateTaskFromMail() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ threadId, projectId }: { threadId: number; projectId?: number }) =>
      createTaskFromMail(threadId, projectId),
    onSuccess: () => client.invalidateQueries({ queryKey: ['mail'] }),
  });
}

export function useSaveMailNote() {
  return useMutation({ mutationFn: (threadId: number) => saveMailNote(threadId) });
}

export function useRemoteImages(threadId: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, allow }: { messageId: number; allow: boolean }) =>
      setRemoteImages(messageId, allow),
    onSuccess: () => client.invalidateQueries({ queryKey: qk.mailThread(threadId) }),
  });
}
