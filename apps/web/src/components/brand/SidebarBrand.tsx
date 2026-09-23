import HelenaMark from '@/components/brand/HelenaMark';
import HelenaWordmark from '@/components/brand/HelenaWordmark';
import { APP_NAME } from '@/utils/app';
import { cn } from '@/lib/utils';

// The product mark at the top of the sidebar: the Helena mark and the wordmark in one
// 32px row like every other sidebar row. Collapses to the mark alone when the sidebar is
// in icon mode. No version and no release notes: the owner wants it quiet
// (2026-09-24). It is not a control, so it has no hover.
export default function SidebarBrand({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex h-8 min-w-0 items-center gap-2 px-1.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0',
        className,
      )}
    >
      <HelenaMark className="size-6 shrink-0" />
      <HelenaWordmark
        label={APP_NAME}
        className="h-3 w-auto shrink-0 text-sidebar-foreground group-data-[collapsible=icon]:hidden"
      />
    </div>
  );
}
