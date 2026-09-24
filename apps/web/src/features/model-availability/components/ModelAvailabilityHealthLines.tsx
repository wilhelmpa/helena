'use client';

import { useTranslations } from 'next-intl';
import type { SystemHealth } from '@/lib/api/endpoints/god';

// The health overview's lines about models a provider refused: each with the agents still set
// to it, which fail until they get another model. Nothing when every model is served.
export default function ModelAvailabilityHealthLines({
  models,
}: {
  models: SystemHealth['models'];
}) {
  const t = useTranslations('modelAvailability.health');
  const refused = models?.unavailable ?? [];
  if (refused.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5 px-2 text-xs text-status-waiting">
      {refused.map((entry) => (
        <li
          key={`${entry.runtime}:${entry.provider}:${entry.model}`}
          title={entry.detail ?? undefined}
          dir="auto"
        >
          {entry.agents.length > 0
            ? t('refused', {
                model: entry.model,
                count: entry.agents.length,
                agents: entry.agents.map((agent) => `@${agent.username}`).join(', '),
              })
            : t('refusedUnused', { model: entry.model })}
        </li>
      ))}
    </ul>
  );
}
