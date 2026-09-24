import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import DisclosureCard from '@/components/common/DisclosureCard';
import DevicesSection from './DevicesSection';

const code = (chunks: ReactNode) => (
  <code dir="ltr" className="rounded bg-muted px-1 py-0.5 text-xs">
    {chunks}
  </code>
);

// How a device is set up. Open while no device syncs; once one does, folded into one
// row the reader opens when setting up the next.
export default function DevicesGuide({
  lanAddress,
  collapsed = false,
}: {
  lanAddress: string | null;
  collapsed?: boolean;
}) {
  const t = useTranslations('devices.guide');
  const body = (
    <>
      <ol className="list-decimal space-y-2 ps-5 text-sm">
        <li>{t('step1')}</li>
        <li>
          {t('step2')}
          {lanAddress ? <> {t.rich('step2Lan', { address: lanAddress, code })}</> : null}
        </li>
        <li>{t('step3')}</li>
        <li>{t.rich('step4', { code })}</li>
        <li>{t('step5')}</li>
      </ol>
      <h3 className="mt-4 text-sm font-medium">{t('iphoneTitle')}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{t.rich('iphone', { code })}</p>
      <h3 className="mt-4 text-sm font-medium">{t('spaceTitle')}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{t.rich('space', { code })}</p>
    </>
  );
  if (collapsed) {
    return (
      <DisclosureCard header={<span className="text-md font-medium">{t('title')}</span>}>
        {body}
      </DisclosureCard>
    );
  }
  return <DevicesSection title={t('title')}>{body}</DevicesSection>;
}
