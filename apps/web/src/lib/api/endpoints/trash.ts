import { request } from '@/lib/api/core/client';

export type TrashKind = 'chat' | 'vault';
export interface TrashPurgeResult {
  dryRun: boolean;
  count: number;
  counts: { kind: TrashKind; teamId: number | null; projectId: number | null; count: number }[];
}
export interface TrashActivity {
  batchId: string;
  kind: TrashKind;
  teamId: number | null;
  projectId: number | null;
  trigger: 'manual' | 'schedule';
  count: number;
  at: string;
}

export const getTeamTrashRetention = (teamId: number) =>
  request<{ days: number }>(`/teams/${teamId}/trash-retention`);
export const setTeamTrashRetention = (teamId: number, days: number) =>
  request<{ days: number }>(`/teams/${teamId}/trash-retention`, {
    method: 'PUT',
    body: JSON.stringify({ days }),
  });
export const getProjectTrashRetention = (projectKey: string) =>
  request<{ days: number | null; effectiveDays: number }>(
    `/projects/${encodeURIComponent(projectKey)}/trash-retention`,
  );
export const setProjectTrashRetention = (projectKey: string, days: number | null) =>
  request<{ days: number | null; effectiveDays: number }>(
    `/projects/${encodeURIComponent(projectKey)}/trash-retention`,
    {
      method: 'PUT',
      body: JSON.stringify({ days }),
    },
  );
export const emptyTeamTrash = (
  teamId: number,
  kind: TrashKind,
  confirmation: { confirmed: true; dryRun?: boolean },
) =>
  request<TrashPurgeResult>(`/teams/${teamId}/trash/${kind}/empty`, {
    method: 'POST',
    body: JSON.stringify(confirmation),
  });
export const emptyProjectTrash = (
  projectKey: string,
  kind: TrashKind,
  confirmation: { confirmed: true; dryRun?: boolean },
) =>
  request<TrashPurgeResult>(`/projects/${encodeURIComponent(projectKey)}/trash/${kind}/empty`, {
    method: 'POST',
    body: JSON.stringify(confirmation),
  });
export const getTeamTrashActivity = (teamId: number) =>
  request<TrashActivity[]>(`/teams/${teamId}/trash-activity`);
export const getProjectTrashActivity = (projectKey: string) =>
  request<TrashActivity[]>(`/projects/${encodeURIComponent(projectKey)}/trash-activity`);
