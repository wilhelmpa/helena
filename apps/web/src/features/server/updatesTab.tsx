import type { ComponentType } from 'react';
import UpdateCenterView, {
  UpdateCheckAction,
} from '@/features/update-center/components/UpdateCenterView';

// Administrator → Server → Updates is the update center (hub/update-center): its view is the
// tab's body and its "check now" action sits in the Server toolbar. It works without the host
// helper, so a container still has this tab. /god/updates redirects here.
export interface UpdatesTabParts {
  built: boolean;
  Body?: ComponentType;
  Action?: ComponentType;
}

export const UPDATES_TAB: UpdatesTabParts = {
  built: true,
  Body: UpdateCenterView,
  Action: UpdateCheckAction,
};
