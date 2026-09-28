import type { TemplateBundle } from '@helena/sdk/web';
import { request } from '@/lib/api/core/client';

// Template bundles (@helena/sdk TemplateBundle): agent templates, their skills and MCP
// servers in and out of a team.

export interface BundleOffer {
  id: string;
  label: string;
  description: string | null;
  pluginId: string;
  version: string;
  agents: number;
  skills: number;
  mcpServers: number;
}

export interface BundleReport {
  lines: string[];
  written: number;
  unchanged: number;
  drift: number;
  warnings: number;
  summary: string;
}

export const getBundleOffers = (teamId: number) =>
  request<BundleOffer[]>(`/teams/${teamId}/template-bundles/offers`);

export const importBundle = (
  teamId: number,
  input: { bundle?: unknown; offer?: string; dryRun: boolean; update: boolean },
) =>
  request<BundleReport>(`/teams/${teamId}/template-bundles/import`, {
    method: 'POST',
    body: JSON.stringify(input),
  });

export const exportBundle = (teamId: number) =>
  request<TemplateBundle>(`/teams/${teamId}/template-bundles/export`);

// A department as a template (Helena › Einstellungen › Abteilungen): its agents, roles,
// reporting lines, heartbeats, routines, goals, skills and budgets, without credentials.
export const exportDepartmentBundle = (teamId: number, departmentId: number) =>
  request<TemplateBundle>(`/teams/${teamId}/template-bundles/departments/${departmentId}/export`);

// The dry run reports what would change and writes nothing; `update` also overwrites
// what differs in existing agents and settings.
export const importDepartmentBundle = (
  teamId: number,
  input: { bundle: unknown; dryRun: boolean; update: boolean },
) =>
  request<BundleReport>(`/teams/${teamId}/template-bundles/departments/import`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
