import { request } from '@/lib/api/core/client';

// One release. The ones above the running version come from the repository's feed
// and carry HTML notes; the ones up to it come from this build's changelog and
// carry markdown.
export interface Release {
  tag: string;
  version: string;
  publishedAt: string;
  url: string | null;
  notes: string;
  notesFormat: 'html' | 'markdown';
}

// How the running version compares to what is published. `latestVersion` and
// `checkedAt` are null until an upstream check has succeeded.
export interface UpdateStatus {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  checkedAt: string | null;
  releases: Release[];
}

// The running version, shown in the sidebar to every signed-in user.
export const getAppVersion = () => request<{ version: string }>('/settings/version');

// Whether a newer release exists, and the release notes behind it. God mode: the
// instance owner is the one who upgrades.
export const getUpdateStatus = () => request<UpdateStatus>('/god/updates');

export const checkForUpdates = () =>
  request<UpdateStatus>('/god/updates/check', { method: 'POST' });
