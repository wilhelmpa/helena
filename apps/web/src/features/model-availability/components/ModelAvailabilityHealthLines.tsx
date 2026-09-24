'use client';

import { useTranslations } from 'next-intl';
import type { SystemHealth } from '@/lib/api/endpoints/god';
import { accountOf } from '../utils/modelFailure';

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
  const logins = (models?.deadLogins ?? []).filter((login) => login.agents.length > 0);
  if (refused.length === 0 && logins.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5 px-2 text-xs text-status-waiting">
      {logins.map((login) => (
        <li key={`login:${login.provider}`} dir="auto">
          {t('deadLogin', {
            account: accountOf(login.provider),
            state: login.state,
            count: login.agents.length,
            agents: login.agents.map((agent) => `@${agent.username}`).join(', '),
          })}
        </li>
      ))}
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
