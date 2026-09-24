import type { ComponentType } from 'react';

// Integration point of the update center (hub/update-center): Administrator → Server →
// Updates mounts its view, and its "check now" action goes into the Server toolbar. Until
// that branch is in this build, the tab is not offered and /god/updates stays where it is.
// After the merge: import `UpdateCenterView` and `UpdateCheckAction` from
// '@/features/update-center/…', set them here, and let /god/updates redirect to
// /god/server/updates (see docs/helena-decisions/server-admin.md §7).
export interface UpdatesTabParts {
  built: boolean;
  Body?: ComponentType;
  Action?: ComponentType;
}

export const UPDATES_TAB: UpdatesTabParts = { built: false };
