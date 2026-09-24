import { useTranslations } from 'next-intl';
import { BRAND_VARIANT, hasLockupMark } from '@helena/brand';
import { APP_NAME } from '@/utils/app';
import HelenaMark from '@/components/brand/HelenaMark';
import HelenaWordmark from '@/components/brand/HelenaWordmark';

// Branded panel shown beside the form on wide screens, in place of an external
// image — self-contained, no asset. Shared by the auth screens and the invite
// accept screen; the subtitle differs per context. It is Hermes' ink in both themes,
// the surface Hermes Agent draws its banner on, so the first screen shows the brand in
// its true gold: the mark with its shadow lines over a faint glow, and the full
// wordmark at one art unit per pixel. On a phone the panel is hidden and
// AuthFormHeader shows the mark above the form instead.
export default function BrandPanel({ subtitle }: { subtitle?: string }) {
  const t = useTranslations('common');
  return (
    <div className="relative hidden min-h-[28rem] flex-col items-center justify-center gap-6 overflow-hidden bg-helena-ink p-10 text-helena-ink-foreground md:flex">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_36%,color-mix(in_oklab,var(--helena-amber-on-ink)_14%,transparent),transparent_60%)]"
      />
      {hasLockupMark(BRAND_VARIANT) && <HelenaMark detail="large" className="relative size-20" />}
      <HelenaWordmark
        size="full"
        label={APP_NAME}
        className="helena-on-ink relative max-w-full text-helena-ink-foreground"
      />
      <p className="relative max-w-[18rem] text-center text-xs text-balance text-helena-ink-muted">
        {subtitle ?? t('brandSubtitle')}
      </p>
    </div>
  );
}
