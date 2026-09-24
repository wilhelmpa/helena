import { useTranslations } from 'next-intl';
import { APP_BYLINE, APP_NAME } from '@/utils/app';
import HelenaMark, { MARK_SPARK } from '@/components/brand/HelenaMark';
import HelenaWordmark from '@/components/brand/HelenaWordmark';

// Branded panel shown beside the form on wide screens, in place of an external
// image — self-contained, no asset. Shared by the auth screens and the invite
// accept screen; the subtitle differs per context. The sidebar's surface with a warm
// glow behind the mark and the mark's spark drawn large and faint in the corner, so
// the first screen already looks like the app. On a phone the panel is hidden and
// AuthFormHeader shows the mark above the form instead.
export default function BrandPanel({ subtitle }: { subtitle?: string }) {
  const t = useTranslations('common');
  return (
    <div className="relative hidden min-h-[28rem] flex-col items-center justify-center gap-5 overflow-hidden border-s border-sidebar-border bg-sidebar p-10 text-sidebar-foreground md:flex">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,color-mix(in_oklab,var(--warning)_16%,transparent),transparent_62%)]"
      />
      <svg
        viewBox="0 0 32 32"
        aria-hidden="true"
        className="pointer-events-none absolute -end-20 -bottom-24 size-96 text-foreground opacity-[0.035]"
      >
        <path d={MARK_SPARK} fill="currentColor" />
      </svg>
      <HelenaMark className="relative size-20 drop-shadow-[0_10px_24px_rgb(40_30_15/0.18)]" />
      <div className="relative flex flex-col items-center gap-2">
        <HelenaWordmark label={APP_NAME} className="h-7 w-auto text-foreground" />
        <span className="text-xs tracking-wide text-muted-foreground">{APP_BYLINE}</span>
      </div>
      <p className="relative max-w-[18rem] text-center text-xs text-balance text-muted-foreground">
        {subtitle ?? t('brandSubtitle')}
      </p>
    </div>
  );
}
