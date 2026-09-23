import HelenaMark from '@/components/brand/HelenaMark';
import HelenaWordmark from '@/components/brand/HelenaWordmark';
import { APP_NAME } from '@/utils/app';
import { cn } from '@/lib/utils';

// The product mark at the top of the sidebar: the Helena mark (28px) and the wordmark
// with 15px caps -- the owner asked for a bigger, clearly readable "Helena"
// (2026-09-24). Collapses to the mark alone when the sidebar is in icon mode. No
// version and no release notes: the owner wants it quiet. It is not a control, so it
// has no hover.
export default function SidebarBrand({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex h-9 min-w-0 items-center gap-2.5 px-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0',
        className,
      )}
    >
      <HelenaMark className="size-7 shrink-0" />
      <HelenaWordmark
        label={APP_NAME}
        className="h-[15px] w-auto shrink-0 text-foreground group-data-[collapsible=icon]:hidden"
      />
    </div>
  );
}
