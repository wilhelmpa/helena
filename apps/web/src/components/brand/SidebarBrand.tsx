'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import HelenaMark from '@/components/brand/HelenaMark';
import HelenaWordmark from '@/components/brand/HelenaWordmark';
import { APP_NAME } from '@/utils/app';
import { cn } from '@/lib/utils';

// The product mark at the top of the sidebar: the torch (24px, three device pixels per
// art pixel on a 2× screen) and the compact wordmark. Collapses to the mark alone when
// the sidebar is in icon mode. No version and no release notes: the owner wants it
// quiet. It leads to Start, as a logo does (owner, 2026-09-24), without a hover fill.
export default function SidebarBrand({ className }: { className?: string }) {
  const t = useTranslations('nav');
  return (
    <Link
      href="/"
      aria-label={`${APP_NAME} – ${t('home')}`}
      className={cn(
        'flex h-9 min-w-0 items-center gap-2.5 rounded-md px-1 outline-none group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0 focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
    >
      <HelenaMark className="size-6 shrink-0" />
      <HelenaWordmark label={APP_NAME} className="shrink-0 group-data-[collapsible=icon]:hidden" />
    </Link>
  );
}
