'use client';

import Shell from '@/components/layout/Shell';
import HomeDashboard from './dashboard/HomeDashboard';

// Start: the reader's dashboard (./dashboard/HomeDashboard). It makes room for a floating
// tool panel instead of hiding under it (--workspace-overlay-inset, WorkspaceLayoutHost).
export default function HomePage() {
  return (
    <Shell globalHome autoOpenGlobalChat={false}>
      <div className="h-full overflow-y-auto pe-(--workspace-overlay-inset)">
        <HomeDashboard />
      </div>
    </Shell>
  );
}
