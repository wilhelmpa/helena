import { request } from '@/lib/api/core/client';
import { pageQuery, type Page, type PageParams } from '@/lib/api/core/paging';

// The curated skill and MCP catalog of a team (API: /teams/:teamId/catalog). A source is
// one GitHub repository or one package; its items are inspected into immutable revisions
// (pin, hash, findings) and only an inspected revision can be adopted.

export type CatalogSourceKind = 'github-skills' | 'npm-mcp' | 'pypi-mcp' | 'github-mcp';

export interface CatalogSource {
  id: number;
  teamId: number;
  kind: CatalogSourceKind;
  // The GitHub repository URL or the package name.
  locator: string;
  role: string;
  enabled: boolean;
  createdAt: string;
}

export interface CatalogFinding {
  code: string;
  severity: 'block' | 'review' | 'info';
  path: string;
  detail: string;
}

// One row of the search: what the list shows about an item.
export interface CatalogItemRow {
  id: number;
  name: string;
  description: string;
  role: string;
  kind: CatalogSourceKind;
  source: string;
  path: string;
  latestPin: string | null;
  installedPin: string | null;
  installed: boolean;
  // How many findings the latest inspection has; null when nothing was inspected yet.
  findings: number | null;
  license: string | null;
}

// A file of an inspected version. `content` is base64; empty when the inspection hid it
// because it looked like a secret.
export interface CatalogSnapshotFile {
  path: string;
  content: string;
  size: number;
  sha256: string;
}

export interface CatalogSnapshot {
  files: CatalogSnapshotFile[];
  markdown: string;
  permissions: string[];
  environment: string[];
  command?: string;
  args?: string[];
}

export interface CatalogRevision {
  id: number;
  itemId: number;
  pin: string;
  sha256: string;
  license: string | null;
  size: number;
  manifest: CatalogSnapshot;
  findings: CatalogFinding[];
  approved: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
}

export interface CatalogRevisionMeta {
  id: number;
  pin: string;
  sha256: string;
  createdAt: string;
}

export interface CatalogScope {
  projectId?: number;
  agentId?: number;
  roleId?: number;
}

export interface CatalogInstall {
  id: number;
  itemId: number;
  teamId: number;
  revisionId: number;
  previousRevisionId: number | null;
  skillId: number | null;
  mcpServerId: number | null;
  scope: CatalogScope;
  installedAt: string;
}

export interface CatalogPreview {
  item: {
    id: number;
    sourceId: number;
    path: string;
    name: string;
    description: string;
    latestRevisionId: number | null;
  };
  source: CatalogSource;
  latest: CatalogRevision | null;
  revisions: CatalogRevisionMeta[];
  install: CatalogInstall | null;
}

export interface CatalogDiff {
  from: string;
  to: string;
  added: string[];
  removed: string[];
  changed: string[];
  files: {
    path: string;
    before: CatalogSnapshotFile | null;
    after: CatalogSnapshotFile | null;
  }[];
  markdownBefore: string;
  markdownAfter: string;
  findingsBefore: CatalogFinding[];
  findingsAfter: CatalogFinding[];
}

export interface CatalogProposal {
  id: number;
  teamId: number;
  itemId: number;
  agentId: number | null;
  proposedBy: string;
  reason: string;
  state: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
}

const base = (teamId: number) => `/teams/${teamId}/catalog`;

export const listCatalogSources = (teamId: number) =>
  request<CatalogSource[]>(`${base(teamId)}/sources`);

export const addCatalogSource = (
  teamId: number,
  input: { kind: CatalogSourceKind; locator: string; role?: string },
) =>
  request<CatalogSource>(`${base(teamId)}/sources`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const removeCatalogSource = (teamId: number, sourceId: number) =>
  request<void>(`${base(teamId)}/sources/${sourceId}`, { method: 'DELETE' });

export const refreshCatalogSource = (teamId: number, sourceId: number) =>
  request<{ count: number }>(`${base(teamId)}/sources/${sourceId}/refresh`, { method: 'POST' });

export const listCatalogItems = (teamId: number, params: PageParams, q: string) =>
  request<Page<CatalogItemRow>>(`${base(teamId)}/items${pageQuery(params, { q: q.trim() })}`);

export const getCatalogPreview = (teamId: number, itemId: number) =>
  request<CatalogPreview>(`${base(teamId)}/items/${itemId}`);

export const inspectCatalogItem = (teamId: number, itemId: number) =>
  request<CatalogRevision>(`${base(teamId)}/items/${itemId}/inspect`, { method: 'POST' });

export const getCatalogDiff = (teamId: number, itemId: number, from: number, to: number) =>
  request<CatalogDiff>(`${base(teamId)}/items/${itemId}/diff?from=${from}&to=${to}`);

export const adoptCatalogItem = (
  teamId: number,
  itemId: number,
  input: { revisionId: number; scope?: CatalogScope; acknowledgeFindings?: boolean },
) =>
  request<CatalogInstall>(`${base(teamId)}/items/${itemId}/adopt`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const rollbackCatalogItem = (teamId: number, itemId: number) =>
  request<CatalogInstall>(`${base(teamId)}/items/${itemId}/rollback`, { method: 'POST' });

export const listCatalogProposals = (teamId: number) =>
  request<CatalogProposal[]>(`${base(teamId)}/proposals`);

export const decideCatalogProposal = (
  teamId: number,
  proposalId: number,
  input: { decision: 'accepted' | 'rejected'; revisionId?: number; acknowledgeFindings?: boolean },
) =>
  request<CatalogProposal>(`${base(teamId)}/proposals/${proposalId}/decision`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
