'use client';

import Shell from '@/components/layout/Shell';
import DesignSwitch from './dashboard/preview/DesignSwitch';

// Start: the owner's dashboard. Preview of three directions (?design=a|b|c) for the owner
// to pick from; the chosen one replaces this switch.
export default function HomePage() {
  return (
    <Shell globalHome>
      <div className="h-full overflow-y-auto pe-(--workspace-overlay-inset)">
        <DesignSwitch />
      </div>
    </Shell>
  );
}
