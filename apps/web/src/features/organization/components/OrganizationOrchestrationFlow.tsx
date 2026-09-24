'use client';

import { useTranslations } from 'next-intl';

const STAGES = ['coordinate', 'specialize', 'review', 'synchronize'] as const;

// The two paths a task takes to the agents, as the architecture contract defines them.
export default function OrganizationOrchestrationFlow() {
  const t = useTranslations('organization.orchestration.flow');

  return (
    <section className="space-y-3 rounded-lg border bg-card p-4 text-sm">
      <h2 className="text-md font-medium">{t('title')}</h2>
      <div>
        <h3 className="text-xs font-medium text-muted-foreground">{t('directTitle')}</h3>
        <p className="mt-1">{t('direct')}</p>
      </div>
      <div>
        <h3 className="text-xs font-medium text-muted-foreground">{t('teamTitle')}</h3>
        <p className="mt-1">{t('team')}</p>
        <ol className="mt-2 list-decimal space-y-1 ps-5">
          {STAGES.map((stage) => (
            <li key={stage}>{t(`stages.${stage}`)}</li>
          ))}
        </ol>
        <p className="mt-2 text-xs text-muted-foreground">{t('route')}</p>
      </div>
    </section>
  );
}
