import { useTranslations } from 'next-intl';
import { Switch } from '@/components/ui/switch';
import { SettingsGroup, SettingsRow } from '@/design-system';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AgentRuntimePolicy } from '@/lib/api/endpoints/agents';
import { CHAT_REFLECTION_BOUNDS, chatReflectionOf, learningOf } from '../../utils/agentLearning';
import BoundedNumberInput from './BoundedNumberInput';
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
    // The agent's memory writes wait on the approvals page only when enabled.
    {
      key: 'memoryApproval',
      on: policy.memoryApproval === true,
      label: t('memoryApproval'),
      hint: t('memoryApprovalHint'),
    },
  ] as const;

  return (
    <SettingsGroup title={t('groupTitle')} description={canEdit ? t('hint') : t('readOnly')}>
      {rows.map((row) => (
        <SettingsRow key={row.key} label={row.label} description={row.hint}>
          {canEdit ? (
            <Switch
              aria-label={row.label}
              checked={row.on}
              onCheckedChange={(checked) => onChange({ ...policy, [row.key]: checked })}
            />
          ) : (
            <TeamSettingState on={row.on} />
          )}
        </SettingsRow>
      ))}
      <SettingsRow label={t('reflectionTitle')} description={t('reflectionHint')}>
        {canEdit ? (
          <Select
            value={current.reflection}
            onValueChange={(value) =>
              onChange({ ...policy, reflection: value as AgentRuntimePolicy['reflection'] })
            }
          >
            <SelectTrigger className="w-60 shrink-0" aria-label={t('reflectionTitle')}>
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
      </SettingsRow>
      <AgentChatReflectionRow policy={policy} canEdit={canEdit} onChange={onChange} />
    </SettingsGroup>
  );
}

// Learning from chats (docs/helena-decisions/agent-context.md §5): whether the agent reflects
// on a chat once it has gone quiet, after how many quiet minutes and after how many of the
// person's messages at the latest.
function AgentChatReflectionRow({
  policy,
  canEdit,
  onChange,
}: {
  policy: AgentRuntimePolicy;
  canEdit: boolean;
  onChange: (policy: AgentRuntimePolicy) => void;
}) {
  const t = useTranslations('teams.agents.abilities.learning');
  const current = chatReflectionOf(policy);
  const learning = policy.learning ?? true;
  return (
    <>
      <SettingsRow label={t('chatReflection')} description={t('chatReflectionHint')}>
        {canEdit ? (
          <Switch
            aria-label={t('chatReflection')}
            checked={current.enabled}
            disabled={!learning}
            onCheckedChange={(checked) => onChange({ ...policy, chatReflection: checked })}
          />
        ) : (
          <TeamSettingState on={current.enabled} />
        )}
      </SettingsRow>
      {current.enabled && (
        <SettingsRow label={t('chatReflectionWhen')} nested>
          <span className="ds-inline-unit">
            {t('chatReflectionIdle')}
            <BoundedNumberInput
              bounds={CHAT_REFLECTION_BOUNDS.idleMinutes}
              placeholder="10"
              disabled={!canEdit}
              value={policy.chatReflectionIdleMinutes}
              onValue={(chatReflectionIdleMinutes) =>
                onChange({ ...policy, chatReflectionIdleMinutes })
              }
            />
          </span>
          <span className="ds-inline-unit">
            {t('chatReflectionTurns')}
            <BoundedNumberInput
              bounds={CHAT_REFLECTION_BOUNDS.everyTurns}
              placeholder="20"
              disabled={!canEdit}
              value={policy.chatReflectionEveryTurns}
              onValue={(chatReflectionEveryTurns) =>
                onChange({ ...policy, chatReflectionEveryTurns })
              }
            />
          </span>
        </SettingsRow>
      )}
    </>
  );
}
