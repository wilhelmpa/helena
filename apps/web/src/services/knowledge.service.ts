import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { searchKnowledge } from '@/lib/api/endpoints/knowledge';
import { qk } from '@/services/queryKeys';

// Full-text search over the notes and files of the vault the reader may see.
export function useKnowledgeSearchQuery(q: string, opts: { enabled: boolean }) {
  const term = q.trim();
  return useQuery({
    queryKey: qk.knowledgeSearch(term),
    queryFn: () => searchKnowledge(term, undefined, 10),
    enabled: opts.enabled && term.length > 0,
    placeholderData: keepPreviousData,
  });
}
