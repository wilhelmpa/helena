import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  captureToKnowledge,
  captureWebPage,
  createNoteFromTemplate,
  findKnowledge,
  listKnowledgeSources,
  listMentions,
  listNoteTemplates,
  openDailyNote,
  reindexKnowledgeSource,
  setSemanticSearch,
  type CaptureInput,
} from '@/lib/api/endpoints/everything';
import { qk } from '@/services/queryKeys';

// The one search over everything the reader may open (⌘K, the agents' search_knowledge).
export function useKnowledgeFindQuery(
  q: string,
  options: { sources?: string[]; project?: string | null; enabled: boolean },
) {
  const term = q.trim();
  const sources = options.sources?.join(',') ?? '';
  const project = options.project ?? '';
  return useQuery({
    queryKey: qk.knowledgeFind(term, sources, project),
    queryFn: ({ signal }) =>
      findKnowledge(
        term,
        { sources: options.sources, project: options.project ?? undefined, limit: 12 },
        signal,
      ),
    enabled: options.enabled && term.length > 0,
    placeholderData: keepPreviousData,
  });
}

// What mentions a task, a note or another item across every source.
export function useMentionsQuery(target: string | null, enabled = true) {
  return useQuery({
    queryKey: qk.knowledgeMentions(target ?? ''),
    queryFn: () => listMentions(target!),
    enabled: enabled && !!target,
  });
}

export function useCaptureMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CaptureInput) => captureToKnowledge(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.knowledge }),
  });
}

export function useCaptureWebPageMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { url: string; html?: string; projectKey?: string }) =>
      captureWebPage(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.knowledge }),
  });
}

export function useOpenDailyNoteMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => openDailyNote(),
    onSuccess: (note) => {
      if (note.created) void queryClient.invalidateQueries({ queryKey: qk.knowledge });
    },
  });
}

export function useNoteTemplatesQuery(enabled = true) {
  return useQuery({ queryKey: qk.knowledgeTemplates, queryFn: listNoteTemplates, enabled });
}

export function useCreateFromTemplateMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createNoteFromTemplate,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.knowledge }),
  });
}

export function useKnowledgeSourcesQuery() {
  return useQuery({
    queryKey: qk.knowledgeSources,
    queryFn: listKnowledgeSources,
    refetchInterval: 10_000,
  });
}

export function useReindexSourceMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: reindexKnowledgeSource,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.knowledgeSources }),
  });
}

export function useSemanticSearchMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: setSemanticSearch,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.knowledgeSources }),
  });
}
