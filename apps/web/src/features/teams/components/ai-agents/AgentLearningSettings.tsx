import { useTranslations } from 'next-intl';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AgentRuntimePolicy } from '@/lib/api/endpoints/agents';
import { learningOf } from '../../utils/agentLearning';
import { TeamSettingState } from '../TeamSettingState';

const REFLECTION_MODES = ['off', 'failure', 'complex'] as const;

// Whether the agent learns in its chats and runs, whether Hermes' curator may archive
// what it learned, whether its memory writes wait for the owner, and when it reflects on a run: a short follow-up turn of the run's
// own session, right after it ends. Saved with the agent; the runner applies all three
// on its next sync.
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
    // The agent's own memory writes wait on the approvals page (a diff per file) unless off.
    {
      key: 'memoryApproval',
      on: policy.memoryApproval ?? true,
      label: t('memoryApproval'),
      hint: t('memoryApprovalHint'),
    },
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
        <li className="flex items-start justify-between gap-4">
          <span className="min-w-0">
            <span className="text-sm">{t('reflectionTitle')}</span>
            <span className="block text-xs text-muted-foreground">{t('reflectionHint')}</span>
          </span>
          {canEdit ? (
            <Select
              value={current.reflection}
              onValueChange={(value) =>
                onChange({ ...policy, reflection: value as AgentRuntimePolicy['reflection'] })
              }
            >
              <SelectTrigger className="w-44 shrink-0" aria-label={t('reflectionTitle')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REFLECTION_MODES.map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {t(
                      mode === 'off'
                        ? 'reflectionOff'
                        : mode === 'failure'
                          ? 'reflectionFailure'
                          : 'reflectionComplex',
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="shrink-0 text-sm text-muted-foreground">
              {t(
                current.reflection === 'off'
                  ? 'reflectionOff'
                  : current.reflection === 'failure'
                    ? 'reflectionFailure'
                    : 'reflectionComplex',
              )}
            </span>
          )}
        </li>
      </ul>
    </div>
  );
}
