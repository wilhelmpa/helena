'use client';

import { PageToolbar } from '@/components/layout/PageToolbar';
import UpdateCenterView, {
  UpdateCheckAction,
} from '@/features/update-center/components/UpdateCenterView';
import GodSectionPage from './components/GodSectionPage';

// Administrator → Updates: the update center on a page of its own (the view is mountable in
// another area too, see UpdateCenterView).
export default function GodUpdatesPage() {
  return (
    <GodSectionPage slug="updates">
      <PageToolbar>
        <UpdateCheckAction />
      </PageToolbar>
      <UpdateCenterView />
    </GodSectionPage>
  );
}
