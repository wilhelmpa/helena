import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { PageParams } from '@/lib/api/core/paging';
import {
  listIssuesAcrossProjects,
  type CrossProjectIssueFilters,
} from '@/lib/api/endpoints/issues';
import { qk } from '@/services/queryKeys';

export function useCrossProjectIssuesQuery(params: PageParams, filters: CrossProjectIssueFilters) {
  return useQuery({
    queryKey: qk.crossProjectIssues(params, filters),
    queryFn: ({ signal }) => listIssuesAcrossProjects(params, filters, signal),
    placeholderData: keepPreviousData,
  });
}
