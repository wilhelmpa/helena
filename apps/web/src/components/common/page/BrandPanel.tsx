import { useTranslations } from 'next-intl';
import { APP_BYLINE, APP_NAME } from '@/utils/app';
import HelenaMark from '@/components/brand/HelenaMark';
import HelenaWordmark from '@/components/brand/HelenaWordmark';

// Branded panel shown beside the form on wide screens, in place of an external
// image — self-contained, no asset. Shared by the auth screens and the invite
// accept screen; the subtitle differs per context. On a phone the panel is hidden
// and AuthFormHeader shows the mark above the form instead.
export default function BrandPanel({ subtitle }: { subtitle?: string }) {
  const t = useTranslations('common');
  return (
    <div className="relative hidden flex-col items-center justify-center gap-4 bg-sidebar p-6 text-sidebar-foreground md:flex">
      <HelenaMark className="size-16" />
      <div className="flex flex-col items-center gap-1.5">
        <HelenaWordmark label={APP_NAME} className="h-6 w-auto text-foreground" />
        <span className="text-xs text-muted-foreground">{APP_BYLINE}</span>
      </div>
      <p className="max-w-[17rem] text-center text-xs text-balance text-muted-foreground">
        {subtitle ?? t('brandSubtitle')}
      </p>
    </div>
  );
}
