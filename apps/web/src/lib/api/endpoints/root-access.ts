import { request } from '../core/client';

export type RootSettings = { enabled: boolean; directOnly: boolean; epoch: number };
export type RootAuditEntry = {
  id: string;
  agentId: number | null;
  runId: number | null;
  messageId: number | null;
  approvalId: number | null;
  command: string;
  reason: string;
  origin: string;
  runtime: string;
  status: string;
  taintSources: string[];
  persistence: string[];
  output: string | null;
  exitCode: number | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};
export const getRootSettings = () => request<RootSettings>('/god/root-access');
export const updateRootSettings = (body: RootSettings) =>
  request<RootSettings>('/god/root-access', {
    method: 'PUT',
    body: JSON.stringify({ enabled: body.enabled, directOnly: body.directOnly }),
  });
export const getRootAudit = () => request<RootAuditEntry[]>('/god/root-access/audit');
