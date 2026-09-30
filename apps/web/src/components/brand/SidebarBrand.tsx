'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import HelenaMark from '@/components/brand/HelenaMark';
import HelenaWordmark from '@/components/brand/HelenaWordmark';
import { useDisplayName } from '@/context/displayName';
import { useLogoHref } from '@/features/ai-chat/hooks/useMainChat';
import { cn } from '@/lib/utils';

// The product mark at the top of the sidebar: the Orb as its 24px gradient disc and the
// compact wordmark. Collapses to the mark alone when
// the sidebar is in icon mode. No version and no release notes: the owner wants it
// quiet. It leads to Ava's Home chat, as the logo of the main sidebar does (owner, O99), without a hover fill.
export default function SidebarBrand({ className }: { className?: string }) {
  const t = useTranslations('nav');
  const appName = useDisplayName();
  const href = useLogoHref();
  return (
    <Link
      href={href}
      aria-label={`${appName} – ${t('home')}`}
      className={cn(
        'flex h-9 min-w-0 items-center gap-2.5 rounded-md px-1 outline-none group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0 focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      <HelenaMark className="size-6 shrink-0" />
      <HelenaWordmark label={appName} className="shrink-0 group-data-[collapsible=icon]:hidden" />
    </Link>
  );
}
