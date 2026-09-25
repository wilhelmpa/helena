'use client';

import { useTranslations } from 'next-intl';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { AgentInventorySkill } from '@/lib/api/endpoints/agents';
import { skillNameClashes } from '../../utils/agentAbilities';

// Skills of the profile that share a name, which Hermes then loads none of
// (docs/helena-decisions/agent-context.md §3). Named here with where each comes from, and
// what puts it right: the Helena skill taken off the agent (the Hermes one, adapted to
// Hermes, then serves), or renamed in the library.
export default function AgentSkillClashes({ skills }: { skills: AgentInventorySkill[] }) {
  const t = useTranslations('teams.agents.abilities');
  const clashes = skillNameClashes(skills);
  if (clashes.length === 0) return null;
  return (
    <Alert variant="destructive">
      <AlertDescription className="space-y-1">
        <p>{t('skillClashes', { count: clashes.length })}</p>
        <ul className="list-disc ps-4">
          {clashes.map((clash) => (
            <li key={clash.name}>
              <span dir="ltr" className="font-mono text-xs">
                {clash.name}
              </span>{' '}
              ({clash.origins.map((origin) => t(`origin.${origin}`)).join(', ')})
            </li>
          ))}
        </ul>
        <p className="text-xs">{t('skillClashesFix')}</p>
      </AlertDescription>
    </Alert>
  );
}
