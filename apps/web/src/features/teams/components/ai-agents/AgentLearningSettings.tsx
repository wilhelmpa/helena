import { useTranslations } from 'next-intl';
import { Checkbox } from '@/components/ui/checkbox';
import type { AgentRuntimePolicy } from '@/lib/api/endpoints/agents';
import { learningOf } from '../../utils/agentLearning';
import { TeamSettingState } from '../TeamSettingState';

// Whether the agent learns in its chats and runs, and whether Hermes' curator may
// archive what it learned. Saved with the agent; the runner applies both on its next sync.
export default function AgentLearningSettings({
  policy,
  canEdit,
  onChange,
}: {
  policy: AgentRuntimePolicy;
  canEdit: boolean;
  onChange: (policy: AgentRuntimePolicy) => void;
}) {
  const t = useTranslations('teams.agents.abilities.learning');
  const current = learningOf(policy);
  const rows = [
    { key: 'learning', on: current.learning, label: t('enabled'), hint: t('enabledHint') },
    { key: 'curator', on: current.curator, label: t('curator'), hint: t('curatorHint') },
  ] as const;

  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-medium">{t('title')}</p>
        <p className="text-xs text-muted-foreground">{canEdit ? t('hint') : t('readOnly')}</p>
      </div>
      <ul className="space-y-2">
        {rows.map((row) => {
          const label = (
            <span className="min-w-0">
              <span className="text-sm">{row.label}</span>
              <span className="block text-xs text-muted-foreground">{row.hint}</span>
            </span>
          );
          return (
            <li key={row.key}>
              {canEdit ? (
                <label className="flex cursor-pointer items-start gap-2">
                  <Checkbox
                    className="mt-0.5"
                    checked={row.on}
                    onCheckedChange={(checked) =>
                      onChange({ ...policy, [row.key]: checked === true })
                    }
                  />
                  {label}
                </label>
              ) : (
                <div className="flex items-start justify-between gap-4">
                  {label}
                  <TeamSettingState on={row.on} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
