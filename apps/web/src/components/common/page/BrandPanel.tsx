import { useTranslations } from 'next-intl';
import { APP_NAME } from '@/utils/app';
import HelenaMark from '@/components/brand/HelenaMark';
import HelenaWordmark from '@/components/brand/HelenaWordmark';

// Branded panel shown beside the form on wide screens, in place of an external
// image — self-contained, no asset. Shared by the auth screens and the invite
// accept screen; the subtitle differs per context.
export default function BrandPanel({ subtitle }: { subtitle?: string }) {
  const t = useTranslations('common');
  return (
    <div className="relative hidden flex-col items-center justify-center gap-4 bg-sidebar text-sidebar-foreground md:flex">
      <HelenaMark className="size-11" />
      <HelenaWordmark label={APP_NAME} className="h-5 w-auto" />
      <p className="max-w-[16rem] text-center text-sm text-muted-foreground">
        {subtitle ?? t('brandSubtitle')}
      </p>
    </div>
  );
}
