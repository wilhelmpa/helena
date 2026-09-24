'use client';

import { useTranslations } from 'next-intl';
import type { SystemHealth } from '@/lib/api/endpoints/god';

// The health overview's lines about models a provider refused that agents are still set to:
// those agents fail until they get another model. A refused model nobody uses is no problem
// (Administrator → Agenten-Laufzeit → Modelle lists it). Nothing when all is well.
export default function ModelAvailabilityHealthLines({
  models,
}: {
  models: SystemHealth['models'];
}) {
  const t = useTranslations('modelAvailability.health');
  const refused = (models?.unavailable ?? []).filter((entry) => entry.agents.length > 0);
  if (refused.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5 px-2 text-xs text-status-waiting">
      {refused.map((entry) => (
        <li
          key={`${entry.runtime}:${entry.provider}:${entry.model}`}
          title={entry.detail ?? undefined}
          dir="auto"
        >
          {t('refused', {
            model: entry.model,
            count: entry.agents.length,
            agents: entry.agents.map((agent) => `@${agent.username}`).join(', '),
          })}
        </li>
      ))}
    </ul>
  );
}
