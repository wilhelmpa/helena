'use client';

import { useTranslations } from 'next-intl';
import { Stack, Text } from '@/design-system';

const STAGES = ['coordinate', 'specialize', 'review', 'synchronize'] as const;

// The two paths a task takes to the agents, as the architecture contract defines them.
export default function OrganizationOrchestrationFlow() {
  const t = useTranslations('organization.orchestration.flow');

  return (
    <Stack as="section" gap={3} pad={4} className="rounded-md border bg-card text-sm">
      <h2 className="text-md font-medium">{t('title')}</h2>
      <div>
        <h3 className="text-xs font-medium text-muted-foreground">{t('directTitle')}</h3>
        <p className="mt-1">{t('direct')}</p>
      </div>
      <div>
        <h3 className="text-xs font-medium text-muted-foreground">{t('teamTitle')}</h3>
        <p className="mt-1">{t('team')}</p>
        <Stack as="ol" gap={1} marginTop={2} padStart={5} className="list-decimal">
          {STAGES.map((stage) => (
            <li key={stage}>{t(`stages.${stage}`)}</li>
          ))}
        </Stack>
        <Text as="p" size="xs" tone="muted" className="mt-2">
          {t('route')}
        </Text>
      </div>
    </Stack>
  );
}
