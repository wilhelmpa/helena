'use client';

import { useQuery } from '@tanstack/react-query';
import { HeartPulse } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { listAgentHeartbeats, type AiAgent } from '@/lib/api/endpoints/agents';
import { useAgentSection } from '@/features/teams/context/agentSection';
import type { AgentFormValue } from '../../utils/agentForm';
import { AgentFormSection } from './AgentFormSection';
import { SettingsGroup, SettingsRow } from '@/design-system';

const DAYS = [1, 2, 3, 4, 5, 6, 0] as const;

// The agent's heartbeat (hub/pc-heartbeats): at a fixed interval, inside its working
// hours and on its days, Helena checks whether there is something for it to do and only
// then starts a run with the heartbeat's instruction. Empty interval = no heartbeat.
// Below: when it last and next beats, and the last checks with their outcome.
export default function AgentHeartbeatSection({
  open,
  onOpenChange,
  value,
  onChange,
  agent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: AgentFormValue;
  onChange: (patch: Partial<AgentFormValue>) => void;
  agent: AiAgent | null;
}) {
  const t = useTranslations('teams.agents.heartbeat');
  const format = useFormatter();
  const { teamId } = useAgentSection();
  const history = useQuery({
    queryKey: ['agent-heartbeats', teamId, agent?.id],
    queryFn: () => listAgentHeartbeats(teamId, agent!.id),
    enabled: open && agent != null,
    staleTime: 30_000,
  });
  const on = value.heartbeatIntervalMinutes.trim() !== '';
  const when = (iso: string | null | undefined) =>
    iso ? format.dateTime(new Date(iso), { dateStyle: 'short', timeStyle: 'short' }) : '–';
  const weekday = (day: number) =>
    format.dateTime(new Date(Date.UTC(2026, 8, 27 + day)), { weekday: 'short', timeZone: 'UTC' });

  return (
    <AgentFormSection
      icon={HeartPulse}
      title={t('title')}
      hint={t('hint')}
      headerRight={on ? t('every', { minutes: Number(value.heartbeatIntervalMinutes) }) : t('off')}
      open={open}
      onOpenChange={onOpenChange}
    >
      <SettingsGroup
        advancedLabel={t('history')}
        advanced={
          agent && (history.data?.length ?? 0) > 0 ? (
            <ul className="ds-heartbeat-history" aria-label={t('history')}>
              {history.data!.slice(0, 8).map((event) => (
                <li key={event.id}>
                  <time dateTime={event.checkedAt}>{when(event.checkedAt)}</time>
                  <span>{t(`outcome.${event.outcome}`)}</span>
                  <span className="ds-heartbeat-reason">{event.reason}</span>
                </li>
              ))}
            </ul>
          ) : undefined
        }
      >
        <SettingsRow label={t('intervalLabel')} description={t('intervalHint')}>
          <span className="ds-inline-unit">
            <Input
              className="w-20"
              inputMode="numeric"
              aria-label={t('intervalLabel')}
              value={value.heartbeatIntervalMinutes}
              placeholder={t('intervalPlaceholder')}
              onChange={(event) =>
                onChange({ heartbeatIntervalMinutes: event.target.value.replace(/\D/g, '') })
              }
            />
            {t('minutes')}
          </span>
        </SettingsRow>
        <SettingsRow label={t('hoursLabel')} description={t('hoursHint')}>
          <span className="ds-inline-unit">
            <Input
              type="time"
              className="w-28"
              aria-label={t('from')}
              value={value.heartbeatStart}
              disabled={!on}
              onChange={(event) => onChange({ heartbeatStart: event.target.value })}
            />
            –
            <Input
              type="time"
              className="w-28"
              aria-label={t('to')}
              value={value.heartbeatEnd}
              disabled={!on}
              onChange={(event) => onChange({ heartbeatEnd: event.target.value })}
            />
          </span>
        </SettingsRow>
        <SettingsRow label={t('days')} description={t('daysHint')}>
          <div className="ds-heartbeat-days" role="group" aria-label={t('days')}>
            {DAYS.map((day) => {
              const active = value.heartbeatDays.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  className="ds-pill ds-pill-button"
                  data-tone={active ? 'active' : 'neutral'}
                  aria-pressed={active}
                  disabled={!on}
                  onClick={() =>
                    onChange({
                      heartbeatDays: active
                        ? value.heartbeatDays.filter((item) => item !== day)
                        : [...value.heartbeatDays, day].sort(),
                    })
                  }
                >
                  {weekday(day)}
                </button>
              );
            })}
          </div>
        </SettingsRow>
        <SettingsRow label={t('timezone')} description={t('timezoneHint')}>
          <Input
            dir="ltr"
            className="w-44"
            aria-label={t('timezone')}
            value={value.heartbeatTimezone}
            disabled={!on}
            onChange={(event) => onChange({ heartbeatTimezone: event.target.value })}
          />
        </SettingsRow>
        <SettingsRow label={t('instructions')} description={t('instructionsHint')} stacked>
          <Textarea
            rows={3}
            aria-label={t('instructions')}
            value={value.heartbeatInstructions}
            disabled={!on}
            placeholder={t('instructionsPlaceholder')}
            onChange={(event) => onChange({ heartbeatInstructions: event.target.value })}
          />
        </SettingsRow>
        {agent && (
          <SettingsRow
            label={t('schedule')}
            description={`${t('last')}: ${when(agent.heartbeatLastAt)}`}
          >
            <span className="ds-agent-overview-value">
              {t('next')}: {on ? when(agent.heartbeatNextAt) : '–'}
            </span>
          </SettingsRow>
        )}
      </SettingsGroup>
    </AgentFormSection>
  );
}
