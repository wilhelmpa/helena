import { useTranslations } from 'next-intl';
import BrandHero from '@/components/brand/BrandHero';

// Branded panel shown beside the form on wide screens, in place of an external
// image — self-contained, no asset. Shared by the auth screens and the invite
// accept screen; the subtitle differs per context. The brand on Hermes' ink, so the
// first screen shows it in its true gold. On a phone the panel is hidden and
// AuthFormHeader shows the mark above the form instead.
export default function BrandPanel({ subtitle }: { subtitle?: string }) {
  const t = useTranslations('common');
  return (
    <BrandHero className="hidden min-h-[28rem] p-10 md:flex">
      <p className="relative max-w-[18rem] text-center text-xs text-balance text-helena-ink-muted">
        {subtitle ?? t('brandSubtitle')}
      </p>
    </BrandHero>
  );
}
