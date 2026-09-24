import { BRAND_VARIANT, hasLockupMark } from '@helena/brand';
import HelenaMark from '@/components/brand/HelenaMark';
import HelenaWordmark from '@/components/brand/HelenaWordmark';
import { APP_NAME } from '@/utils/app';
import { cn } from '@/lib/utils';

// The product mark at the top of the sidebar: the Helena mark (24px, three device pixels
// per art pixel on a 2× screen) and the compact wordmark. Collapses to the mark alone
// when the sidebar is in icon mode. The monogram variant shows the wordmark alone while
// open (its mark is the wordmark's own H). No version and no release notes: the owner
// wants it quiet. It is not a control, so it has no hover.
export default function SidebarBrand({ className }: { className?: string }) {
  const withMark = hasLockupMark(BRAND_VARIANT);
  return (
    <div
      className={cn(
        'flex h-9 min-w-0 items-center gap-2.5 px-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0',
        className,
      )}
    >
      <HelenaMark
        className={cn('size-6 shrink-0', !withMark && 'hidden group-data-[collapsible=icon]:block')}
      />
      <HelenaWordmark
        label={APP_NAME}
        className="shrink-0 text-foreground group-data-[collapsible=icon]:hidden"
      />
    </div>
  );
}
