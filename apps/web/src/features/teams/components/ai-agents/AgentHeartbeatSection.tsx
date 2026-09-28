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
      <div className="ds-heartbeat">
        <label className="ds-heartbeat-field">
          <span>{t('interval')}</span>
          <Input
            inputMode="numeric"
            value={value.heartbeatIntervalMinutes}
            placeholder={t('intervalPlaceholder')}
            onChange={(event) =>
              onChange({ heartbeatIntervalMinutes: event.target.value.replace(/\D/g, '') })
            }
          />
        </label>
        <div className="ds-heartbeat-row">
          <label className="ds-heartbeat-field">
            <span>{t('from')}</span>
            <Input
              type="time"
              value={value.heartbeatStart}
              disabled={!on}
              onChange={(event) => onChange({ heartbeatStart: event.target.value })}
            />
          </label>
          <label className="ds-heartbeat-field">
            <span>{t('to')}</span>
            <Input
              type="time"
              value={value.heartbeatEnd}
              disabled={!on}
              onChange={(event) => onChange({ heartbeatEnd: event.target.value })}
            />
          </label>
          <label className="ds-heartbeat-field">
            <span>{t('timezone')}</span>
            <Input
              dir="ltr"
              value={value.heartbeatTimezone}
              disabled={!on}
              onChange={(event) => onChange({ heartbeatTimezone: event.target.value })}
            />
          </label>
        </div>
        <div className="ds-heartbeat-field">
          <span>{t('days')}</span>
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
        </div>
        <label className="ds-heartbeat-field">
          <span>{t('instructions')}</span>
          <Textarea
            rows={3}
            value={value.heartbeatInstructions}
            disabled={!on}
            placeholder={t('instructionsPlaceholder')}
            onChange={(event) => onChange({ heartbeatInstructions: event.target.value })}
          />
        </label>
        {agent && (
          <dl className="ds-props">
            <div className="ds-prop">
              <dt>{t('last')}</dt>
              <dd>{when(agent.heartbeatLastAt)}</dd>
            </div>
            <div className="ds-prop">
              <dt>{t('next')}</dt>
              <dd>{on ? when(agent.heartbeatNextAt) : '–'}</dd>
            </div>
          </dl>
        )}
        {agent && (history.data?.length ?? 0) > 0 && (
          <div className="ds-heartbeat-history">
            <span className="ds-mono-label">{t('history')}</span>
            <ul>
              {history.data!.slice(0, 8).map((event) => (
                <li key={event.id}>
                  <time dateTime={event.checkedAt}>{when(event.checkedAt)}</time>
                  <span>{t(`outcome.${event.outcome}`)}</span>
                  <span className="ds-heartbeat-reason">{event.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </AgentFormSection>
  );
}
