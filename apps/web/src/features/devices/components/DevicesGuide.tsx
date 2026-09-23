import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import DevicesSection from './DevicesSection';

const code = (chunks: ReactNode) => (
  <code dir="ltr" className="rounded bg-muted px-1 py-0.5 text-xs">
    {chunks}
  </code>
);

export default function DevicesGuide({ lanAddress }: { lanAddress: string | null }) {
  const t = useTranslations('devices.guide');
  return (
    <DevicesSection title={t('title')}>
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
      <h3 className="mt-5 text-sm font-semibold">{t('iphoneTitle')}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{t.rich('iphone', { code })}</p>
      <h3 className="mt-5 text-sm font-semibold">{t('spaceTitle')}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{t.rich('space', { code })}</p>
    </DevicesSection>
  );
}
