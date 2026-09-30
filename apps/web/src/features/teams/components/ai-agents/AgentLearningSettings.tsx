'use client';

import { Moon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { LimitMeter, Pill, SettingsGroup, SettingsRow, Switch } from '@/design-system';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AgentRuntimePolicy } from '@/lib/api/endpoints/agents';
import {
  LIMIT_AREAS,
  type LimitArea,
  type SizeLimits,
} from '@/features/agent-runtime/utils/sizeLimits';
import { CHAT_REFLECTION_BOUNDS, chatReflectionOf, learningOf } from '../../utils/agentLearning';
import BoundedNumberInput from './BoundedNumberInput';
import { TeamSettingState } from '../TeamSettingState';

const REFLECTION_MODES = ['off', 'failure', 'complex'] as const;

// How an agent learns, in words that need no knowledge of what runs underneath: whether it
// learns from what it does, tidies its skills, shows its changes first, looks back after runs
// and chats; the nightly consolidation of its notes ("Träumen"); and how much text each part
// of its context may hold. Saved with the agent.
export default function AgentLearningSettings({
  policy,
  canEdit,
  onChange,
  dreams,
  limits,
}: {
  policy: AgentRuntimePolicy;
  canEdit: boolean;
  onChange: (policy: AgentRuntimePolicy) => void;
  // Whether the agent's runtime consolidates its notes at night.
  dreams: boolean;
  limits: SizeLimits;
}) {
  const t = useTranslations('agentPages.learning');
  const current = learningOf(policy);
  const rows = [
    { key: 'learning', on: current.learning },
    { key: 'curator', on: current.curator },
    { key: 'memoryApproval', on: policy.memoryApproval === true },
  ] as const;
  const shownLimits = LIMIT_AREAS.filter((area) => limits[area]);

  return (
    <>
      <SettingsGroup
        title={t('learn.title')}
        description={canEdit ? t('learn.hint') : t('readOnly')}
      >
        {rows.map((row) => (
          <SettingsRow
            key={row.key}
            label={t(`${row.key}.label`)}
            description={t(`${row.key}.hint`)}
          >
            {canEdit ? (
              <Switch
                aria-label={t(`${row.key}.label`)}
                checked={row.on}
                onCheckedChange={(checked) => onChange({ ...policy, [row.key]: checked })}
              />
            ) : (
              <TeamSettingState on={row.on} />
            )}
          </SettingsRow>
        ))}
        <SettingsRow label={t('reflection.label')} description={t('reflection.hint')}>
          {canEdit ? (
            <Select
              value={current.reflection}
              onValueChange={(value) =>
                onChange({ ...policy, reflection: value as AgentRuntimePolicy['reflection'] })
              }
            >
              <SelectTrigger className="w-60 shrink-0" aria-label={t('reflection.label')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REFLECTION_MODES.map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {t(`reflection.${mode}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="ds-agent-overview-value">{t(`reflection.${current.reflection}`)}</span>
          )}
        </SettingsRow>
        <ChatReflectionRows policy={policy} canEdit={canEdit} onChange={onChange} />
      </SettingsGroup>

      {dreams && (
        <SettingsGroup title={t('dream.title')} description={t('dream.hint')}>
          <SettingsRow label={t('dream.label')} description={t('dream.text')}>
            <Pill icon={<Moon />}>{t('dream.when')}</Pill>
          </SettingsRow>
        </SettingsGroup>
      )}

      {shownLimits.length > 0 && (
        <SettingsGroup title={t('limits.title')} description={t('limits.hint')}>
          {shownLimits.map((area: LimitArea) => (
            <SettingsRow key={area} label={t(`limits.areas.${area}`)} stacked>
              <LimitMeter
                used={limits[area]!.used}
                limit={limits[area]!.limit}
                truncated={limits[area]!.truncated}
              />
            </SettingsRow>
          ))}
        </SettingsGroup>
      )}
    </>
  );
}

// Learning from chats: whether the agent looks back on a chat once it has gone quiet, after how
// many quiet minutes and after how many of your messages at the latest.
function ChatReflectionRows({
  policy,
  canEdit,
  onChange,
}: {
  policy: AgentRuntimePolicy;
  canEdit: boolean;
  onChange: (policy: AgentRuntimePolicy) => void;
}) {
  const t = useTranslations('agentPages.learning.chats');
  const current = chatReflectionOf(policy);
  const learning = policy.learning ?? true;
  return (
    <>
      <SettingsRow label={t('label')} description={t('hint')}>
        {canEdit ? (
          <Switch
            aria-label={t('label')}
            checked={current.enabled}
            disabled={!learning}
            onCheckedChange={(checked) => onChange({ ...policy, chatReflection: checked })}
          />
        ) : (
          <TeamSettingState on={current.enabled} />
        )}
      </SettingsRow>
      {current.enabled && (
        <SettingsRow label={t('when')} nested>
          <span className="ds-inline-unit">
            {t('idle')}
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
            {t('turns')}
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
