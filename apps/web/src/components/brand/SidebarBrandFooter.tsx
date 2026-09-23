'use client';

import HelenaMark from '@/components/brand/HelenaMark';
import HelenaWordmark from '@/components/brand/HelenaWordmark';
import { APP_NAME } from '@/utils/app';

// The product mark at the bottom of both sidebars. Collapses to the mark alone when the
// sidebar is in icon mode. No version and no release notes here: the owner wants the
// footer quiet.
export default function SidebarBrandFooter() {
  return (
    <div className="flex w-full items-center gap-2.5 px-2 pt-2 pb-1.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
      <HelenaMark className="size-7 shrink-0" />
      <div className="grid text-start leading-none group-data-[collapsible=icon]:hidden">
        <HelenaWordmark label={APP_NAME} className="h-3.5 w-auto text-sidebar-foreground" />
      </div>
    </div>
  );
}
