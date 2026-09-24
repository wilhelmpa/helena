import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import type { RuntimeAction } from '@/lib/api/endpoints/agentLearning';
import type { AgentInventorySkill } from '@/lib/api/endpoints/agents';
import { skillGroups } from '../../utils/agentAbilities';
import AgentLearnedSkillRow from './AgentLearnedSkillRow';
import { AgentListSearch, SEARCH_THRESHOLD } from './AgentListSearch';

// What the owner can do about the skills the agent learned, when its runner carries it out.
export interface LearnedSkillControls {
  agentId: number;
  actions: RuntimeAction[] | undefined;
  onPromoted: (skillId: number) => void;
}

// The skills in the agent's Hermes profile, bundled, installed and learned in one list. A
// skill that did not ship with Hermes says where it came from, so the ones the agent
// learned itself stand out, with what the owner can do about them. Each one can be turned
// off for the agent (Hermes' skills.disabled, saved with the agent).
export default function AgentSkillInventory({
  skills,
  learned,
  disabled,
  onDisabledChange,
}: {
  skills: AgentInventorySkill[];
  learned: LearnedSkillControls | null;
  // The names of the skills turned off; null onDisabledChange shows them read-only.
  disabled: string[];
  onDisabledChange: ((disabled: string[]) => void) | null;
}) {
  const t = useTranslations('teams.agents.abilities');
  const tAgents = useTranslations('teams.agents');
  const [query, setQuery] = useState('');
  const groups = useMemo(() => skillGroups(skills, query), [skills, query]);

  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-medium">{t('skills')}</p>
        <p className="text-xs text-muted-foreground">
          {t('skillsHint', { count: skills.length })}
          {disabled.length > 0 && ` · ${t('skillsDisabled', { count: disabled.length })}`}
        </p>
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
                      key={skill.path ?? `${skill.name}-${index}`}
                      className="flex items-start gap-3"
                    >
                      <div
                        className={cn(
                          'min-w-0 flex-1',
                          disabled.includes(skill.name) && 'opacity-60',
                        )}
                      >
                        {learned && skill.origin === 'agent' && skill.path ? (
                          <AgentLearnedSkillRow skill={skill} path={skill.path} {...learned} />
                        ) : (
                          <div className="flex items-start justify-between gap-3">
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
                        )}
                      </div>
                      <Switch
                        size="sm"
                        className="mt-1"
                        checked={!disabled.includes(skill.name)}
                        disabled={!onDisabledChange}
                        aria-label={t('skillEnabled', { name: skill.name })}
                        onCheckedChange={(on) =>
                          onDisabledChange?.(
                            on
                              ? disabled.filter((name) => name !== skill.name)
                              : [...disabled, skill.name],
                          )
                        }
                      />
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
