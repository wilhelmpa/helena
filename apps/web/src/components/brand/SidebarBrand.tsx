'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import HelenaMark from '@/components/brand/HelenaMark';
import HelenaWordmark from '@/components/brand/HelenaWordmark';
import { APP_NAME } from '@/utils/app';
import ReleaseHistory from '@/features/whats-new/components/ReleaseHistory';
import { useSession } from '@/lib/auth-client';
import { cn } from '@/lib/utils';
import { useAppVersionQuery, useUpdateStatusQuery } from '@/services/updates.service';

// The product mark at the top of the sidebar: the Helena mark, the wordmark and the
// running version beside it, in one 32px row like every other sidebar row. Collapses to
// the mark alone when the sidebar is in icon mode.
//
// The instance owner also sees whether a newer release is published and opens the
// release notes from here — they are the one who upgrades the instance, so the check
// is theirs alone (GET /god/updates). Everyone else sees the version only, as plain
// text: nothing about it looks clickable.
export default function SidebarBrand({ className }: { className?: string }) {
  const t = useTranslations('updates');
  const { data: session } = useSession();
  // The session store can already be filled by the time React hydrates, while the
  // server rendered without it. Reading it only after mount keeps the server and
  // the first client render identical.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isGod = mounted && session?.user.role === 'god';

  const { data: appVersion } = useAppVersionQuery();
  const { data: status } = useUpdateStatusQuery(isGod);
  const [showUpdates, setShowUpdates] = useState(false);

  const version = appVersion?.version ?? status?.currentVersion;
  // The version to offer, or null when the running one is the newest known.
  const newerVersion = status?.updateAvailable ? status.latestVersion : null;

  const layout = cn(
    'flex h-8 min-w-0 items-center gap-2 rounded-md px-1.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0',
    className,
  );

  const content = (
    <>
      <HelenaMark className="size-6 shrink-0" />
      <HelenaWordmark
        label={APP_NAME}
        className="h-3 w-auto shrink-0 text-sidebar-foreground group-data-[collapsible=icon]:hidden"
      />
      {newerVersion ? (
        <span className="flex min-w-0 items-center gap-1 font-mono text-xs text-status-success group-data-[collapsible=icon]:hidden">
          {/* A pulsing ring around the dot, so the update is noticed. */}
          <span className="relative flex size-1.5 shrink-0" aria-hidden>
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-status-success opacity-75 motion-reduce:hidden" />
            <span className="relative inline-flex size-1.5 rounded-full bg-status-success" />
          </span>
          <span className="truncate">{`v${newerVersion}`}</span>
        </span>
      ) : (
        version && (
          <span className="truncate font-mono text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
            {`v${version}`}
          </span>
        )
      )}
    </>
  );

  // Without the owner's release data there is nothing to open, so the brand stays the
  // plain mark it is for everyone else.
  if (!status) return <div className={layout}>{content}</div>;

  return (
    <>
      <button
        type="button"
        className={cn(layout, 'text-start transition-colors hover:bg-sidebar-accent')}
        title={newerVersion ? `${t('updateAvailable')}: v${newerVersion}` : t('releaseHistory')}
        onClick={() => setShowUpdates(true)}
      >
        {content}
      </button>
      {showUpdates && <ReleaseHistory status={status} onClose={() => setShowUpdates(false)} />}
    </>
  );
}
