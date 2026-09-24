'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { ProjectAutopilot } from '@/lib/api/endpoints/autopilot';
import AutopilotLevelBadge from './AutopilotLevelBadge';

// The agents of the project and the level each works at, with where it comes from: the
// project's, an agent's own stricter one, or one the owner raised.
export default function AutopilotAgentList({
  agents,
  agentHref,
}: {
  agents: ProjectAutopilot['agents'];
  agentHref: (agentId: number) => string;
}) {
  const t = useTranslations('autopilot');
  if (agents.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">{t('agentsEmpty')}</p>;
  }
  return (
    <ul className="divide-y divide-border/60">
      {agents.map((agent) => (
        <li key={agent.id}>
          <Link
            href={agentHref(agent.id)}
            className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-accent"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{agent.name}</span>
              <span className="block truncate text-xs text-muted-foreground">
                @{agent.username} · {t(`source.${agent.effective.source}`)}
                {agent.paused ? ` · ${t('paused')}` : ''}
              </span>
            </span>
            <AutopilotLevelBadge level={agent.effective.level} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
