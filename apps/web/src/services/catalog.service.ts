// The team's curated skill and MCP catalog: sources, searched items, previews, adoption,
// rollback and the agents' proposals. Everything belongs to the team, so every hook is
// keyed by it; a write refreshes the whole team prefix and the skill library (an adoption
// creates or replaces a skill there).

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type CatalogItemRow,
  type CatalogScope,
  type CatalogSourceKind,
  addCatalogSource,
  adoptCatalogItem,
  decideCatalogProposal,
  getCatalogDiff,
  getCatalogPreview,
  inspectCatalogItem,
  listCatalogItems,
  listCatalogProposals,
  listCatalogSources,
  refreshCatalogSource,
  removeCatalogSource,
  rollbackCatalogItem,
} from '@/lib/api/endpoints/catalog';
import type { PageParams } from '@/lib/api/core/paging';
import { qk } from '@/services/queryKeys';

// The catalog shows its own errors in place, in the reader's language (catalogErrors.ts).
const OWN_ERRORS = { suppressErrorToast: true } as const;

export function useCatalogSourcesQuery(teamId: number | null) {
  return useQuery({
    queryKey: qk.catalogSources(teamId ?? 0),
    queryFn: () => listCatalogSources(teamId!),
    enabled: teamId != null,
  });
}

// One page of the search, for the list of the Katalog tab.
export function useCatalogItemsPage(teamId: number | null, params: PageParams, q: string) {
  return useQuery({
    queryKey: qk.catalogItems(teamId ?? 0, params, q.trim()),
    queryFn: () => listCatalogItems(teamId!, params, q),
    enabled: teamId != null,
    placeholderData: keepPreviousData,
  });
}

// Every item, read page by page: what the Updates and Vorschläge tabs name their rows by,
// and what the tab counts come from. The catalog is curated, so it stays small.
export function useCatalogIndex(teamId: number | null) {
  return useQuery({
    queryKey: qk.catalogIndex(teamId ?? 0),
    enabled: teamId != null,
    queryFn: async () => {
      const items: CatalogItemRow[] = [];
      for (let page = 1; page <= 20; page += 1) {
        const result = await listCatalogItems(teamId!, { page, pageSize: 100 }, '');
        items.push(...result.items);
        if (items.length >= result.total) break;
      }
      return items;
    },
  });
}

// One item: its latest inspected version with files and findings, its versions and its
// installation.
export function useCatalogPreviewQuery(teamId: number | null, itemId: number | null) {
  return useQuery({
    queryKey: qk.catalogPreview(teamId ?? 0, itemId ?? 0),
    queryFn: () => getCatalogPreview(teamId!, itemId!),
    enabled: teamId != null && itemId != null,
  });
}

export function useCatalogDiffQuery(
  teamId: number,
  itemId: number,
  from: number | null,
  to: number | null,
) {
  return useQuery({
    queryKey: qk.catalogDiff(teamId, itemId, from ?? 0, to ?? 0),
    queryFn: () => getCatalogDiff(teamId, itemId, from!, to!),
    enabled: from != null && to != null && from !== to,
  });
}

export function useCatalogProposalsQuery(teamId: number | null) {
  return useQuery({
    queryKey: qk.catalogProposals(teamId ?? 0),
    queryFn: () => listCatalogProposals(teamId!),
    enabled: teamId != null,
  });
}

function useRefreshCatalog(teamId: number) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: qk.catalog(teamId) });
    void qc.invalidateQueries({ queryKey: qk.agentSkills(teamId) });
    void qc.invalidateQueries({ queryKey: qk.teams });
  };
}

export function useAddCatalogSource(teamId: number) {
  const refresh = useRefreshCatalog(teamId);
  return useMutation({
    meta: OWN_ERRORS,
    mutationFn: (input: { kind: CatalogSourceKind; locator: string; role?: string }) =>
      addCatalogSource(teamId, input),
    onSuccess: refresh,
  });
}

export function useRemoveCatalogSource(teamId: number) {
  const refresh = useRefreshCatalog(teamId);
  return useMutation({
    meta: OWN_ERRORS,
    mutationFn: (sourceId: number) => removeCatalogSource(teamId, sourceId),
    onSuccess: refresh,
  });
}

export function useRefreshCatalogSource(teamId: number) {
  const refresh = useRefreshCatalog(teamId);
  return useMutation({
    meta: OWN_ERRORS,
    mutationFn: (sourceId: number) => refreshCatalogSource(teamId, sourceId),
    onSuccess: refresh,
  });
}

export function useInspectCatalogItem(teamId: number) {
  const refresh = useRefreshCatalog(teamId);
  return useMutation({
    meta: OWN_ERRORS,
    mutationFn: (itemId: number) => inspectCatalogItem(teamId, itemId),
    onSuccess: refresh,
  });
}

export function useAdoptCatalogItem(teamId: number) {
  const refresh = useRefreshCatalog(teamId);
  return useMutation({
    meta: OWN_ERRORS,
    mutationFn: (input: {
      itemId: number;
      revisionId: number;
      scope?: CatalogScope;
      acknowledgeFindings?: boolean;
    }) => {
      const { itemId, ...body } = input;
      return adoptCatalogItem(teamId, itemId, body);
    },
    onSuccess: refresh,
  });
}

export function useRollbackCatalogItem(teamId: number) {
  const refresh = useRefreshCatalog(teamId);
  return useMutation({
    meta: OWN_ERRORS,
    mutationFn: (itemId: number) => rollbackCatalogItem(teamId, itemId),
    onSuccess: refresh,
  });
}

export function useDecideCatalogProposal(teamId: number) {
  const refresh = useRefreshCatalog(teamId);
  return useMutation({
    meta: OWN_ERRORS,
    mutationFn: (input: {
      proposalId: number;
      decision: 'accepted' | 'rejected';
      revisionId?: number;
      acknowledgeFindings?: boolean;
    }) => {
      const { proposalId, ...body } = input;
      return decideCatalogProposal(teamId, proposalId, body);
    },
    onSuccess: refresh,
  });
}
