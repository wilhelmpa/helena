import { Card } from '@/design-system';
import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { useRelativeTime } from '@/context/relativeTimeContext';
import { useSyncConflicts } from '../services/deviceSync.service';
import DevicesSection from './DevicesSection';

export default function DevicesConflicts() {
  const t = useTranslations('devices.conflicts');
  const relativeTime = useRelativeTime();
  const conflicts = useSyncConflicts();
  const items = conflicts.data?.items ?? [];

  let content: ReactNode;
  if (conflicts.isError) {
    content = <p className="text-sm text-destructive">{t('loadError')}</p>;
  } else if (conflicts.data && items.length === 0) {
    content = <p className="text-sm text-muted-foreground">{t('empty')}</p>;
  } else {
    content = (
      <ul dir="ltr" className="space-y-2">
        {items.map((item) => (
          <Card as="li" key={item.path} tone="inset" pad="tight" gap={0}>
            <code className="block text-xs font-medium break-all">{item.path}</code>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('original', { path: item.originalPath })}
              {' · '}
              {t('modified', { time: relativeTime(item.modifiedAt) })}
            </p>
          </Card>
        ))}
      </ul>
    );
  }

  return (
    <DevicesSection title={t('title')} hint={t('hint')}>
      {content}
    </DevicesSection>
  );
}
