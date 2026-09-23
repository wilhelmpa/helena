import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import type { AgentInventorySkill } from '@/lib/api/endpoints/agents';
import { skillGroups } from '../../utils/agentAbilities';
import { AgentListSearch, SEARCH_THRESHOLD } from './AgentListSearch';

// The skills in the agent's Hermes profile, read-only. A skill that did not ship with
// Hermes says where it came from, so the ones the agent wrote itself stand out.
export default function AgentSkillInventory({ skills }: { skills: AgentInventorySkill[] }) {
  const t = useTranslations('teams.agents.abilities');
  const tAgents = useTranslations('teams.agents');
  const [query, setQuery] = useState('');
  const groups = useMemo(() => skillGroups(skills, query), [skills, query]);

  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-medium">{t('skills')}</p>
        <p className="text-xs text-muted-foreground">{t('skillsHint', { count: skills.length })}</p>
      </div>
      {skills.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('noSkills')}</p>
      ) : (
        <>
          {skills.length > SEARCH_THRESHOLD && (
            <AgentListSearch value={query} onChange={setQuery} placeholder={t('searchSkills')} />
          )}
          <div className="max-h-96 space-y-4 overflow-y-auto pe-1">
            {groups.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">
                {tAgents('noMatch', { query: query.trim() })}
              </p>
            ) : (
              groups.map(([category, items]) => (
                <div key={category} className="space-y-1.5">
                  <p className="text-xs font-medium tracking-wide text-muted-foreground">
                    {category || t('uncategorized')}
                  </p>
                  {items.map((skill, index) => (
                    <div
                      key={`${skill.name}-${index}`}
                      className="flex items-start justify-between gap-3"
                    >
                      <span className="min-w-0" dir="auto">
                        <span className="text-sm">{skill.name}</span>
                        {skill.description && (
                          <span className="block text-xs text-muted-foreground">
                            {skill.description}
                          </span>
                        )}
                      </span>
                      {skill.origin !== 'bundled' && (
                        <Badge
                          variant={skill.origin === 'agent' ? 'secondary' : 'outline'}
                          className="shrink-0"
                        >
                          {t(`origin.${skill.origin}`)}
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
