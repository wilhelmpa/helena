'use client';

import { useQuery } from '@tanstack/react-query';
import { HeartPulse } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { listAgentHeartbeats, type AiAgent } from '@/lib/api/endpoints/agents';
import { useAgentSection } from '@/features/teams/context/agentSection';
import { useAgentAutopilot } from '@/services/autopilot.service';
import { budgetState, leadingBudget } from '@/features/home/dashboard/budgetAlerts';
import type { AgentFormValue } from '../../utils/agentForm';
import { heartbeatHistory } from '../../utils/heartbeatHistory';
import { AgentFormSection } from './AgentFormSection';
import {
  Inline,
  List,
  ListRow,
  Pill,
  PillButton,
  SettingsGroup,
  SettingsRow,
  Stack,
  Text,
  TextArea,
  TextField,
} from '@/design-system';

const DAYS = [1, 2, 3, 4, 5, 6, 0] as const;

// The agent's heartbeat (hub/pc-heartbeats, Paperclip): at a fixed interval, inside its
// working hours and on its days, Helena checks whether there is something for it to do —
// borderline cases through a quick local precheck — and only then starts a run with the
// heartbeat's instruction. Empty interval = no heartbeat. Below: the beat (last, next, and
// whether a budget slows it) and the last checks, the skipped ones bundled (owner 28.09.).
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
    queryKey: ['agent-heartbeats', teamId, agent?.id, 'all'],
    queryFn: () => listAgentHeartbeats(teamId, agent!.id, true),
    enabled: open && agent != null,
    staleTime: 30_000,
  });
  // A budget at 80 % or more doubles the interval (the heartbeat's throttle).
  const autopilot = useAgentAutopilot(teamId, open && agent && !agent.template ? agent.id : null);
  const throttled =
    budgetState(
      leadingBudget([
        ...(autopilot.data?.budgets ?? []),
        ...(autopilot.data?.projects.flatMap((project) => project.budgets) ?? []),
      ]),
    ) !== 'ok';
  const on = value.heartbeatIntervalMinutes.trim() !== '';
  const when = (iso: string | null | undefined) =>
    iso ? format.dateTime(new Date(iso), { dateStyle: 'short', timeStyle: 'short' }) : '–';
  const time = (iso: string) => format.dateTime(new Date(iso), { timeStyle: 'short' });
  const weekday = (day: number) =>
    format.dateTime(new Date(Date.UTC(2026, 8, 27 + day)), { weekday: 'short', timeZone: 'UTC' });
  const items = heartbeatHistory(history.data ?? []).slice(0, 10);

  return (
    <AgentFormSection
      icon={HeartPulse}
      title={t('title')}
      hint={t('hint')}
      headerRight={on ? t('every', { minutes: Number(value.heartbeatIntervalMinutes) }) : t('off')}
      open={open}
      onOpenChange={onOpenChange}
    >
      <SettingsGroup>
        <SettingsRow label={t('intervalLabel')} description={t('intervalHint')}>
          <Inline gap={2}>
            <TextField
              inputMode="numeric"
              aria-label={t('intervalLabel')}
              value={value.heartbeatIntervalMinutes}
              placeholder={t('intervalPlaceholder')}
              onChange={(event) =>
                onChange({ heartbeatIntervalMinutes: event.target.value.replace(/\D/g, '') })
              }
            />
            <Text size="sm" tone="muted">
              {t('minutes')}
            </Text>
          </Inline>
        </SettingsRow>
        <SettingsRow label={t('hoursLabel')} description={t('hoursHint')}>
          <Inline gap={2}>
            <TextField
              type="time"
              aria-label={t('from')}
              value={value.heartbeatStart}
              onChange={(event) => onChange({ heartbeatStart: event.target.value })}
            />
            <Text tone="muted">–</Text>
            <TextField
              type="time"
              aria-label={t('to')}
              value={value.heartbeatEnd}
              onChange={(event) => onChange({ heartbeatEnd: event.target.value })}
            />
          </Inline>
        </SettingsRow>
        <SettingsRow label={t('days')} description={t('daysHint')}>
          <Inline gap={1} wrap role="group" aria-label={t('days')}>
            {DAYS.map((day) => {
              const active = value.heartbeatDays.includes(day);
              return (
                <PillButton
                  key={day}
                  tone={active ? 'active' : 'neutral'}
                  aria-pressed={active}
                  onClick={() =>
                    onChange({
                      heartbeatDays: active
                        ? value.heartbeatDays.filter((item) => item !== day)
                        : [...value.heartbeatDays, day].sort(),
                    })
                  }
                >
                  {weekday(day)}
                </PillButton>
              );
            })}
          </Inline>
        </SettingsRow>
        <SettingsRow label={t('timezone')} description={t('timezoneHint')}>
          <TextField
            dir="ltr"
            aria-label={t('timezone')}
            value={value.heartbeatTimezone}
            onChange={(event) => onChange({ heartbeatTimezone: event.target.value })}
          />
        </SettingsRow>
        <SettingsRow label={t('instructions')} description={t('instructionsHint')} stacked>
          <TextArea
            rows={3}
            aria-label={t('instructions')}
            value={value.heartbeatInstructions}
            placeholder={t('instructionsPlaceholder')}
            onChange={(event) => onChange({ heartbeatInstructions: event.target.value })}
          />
        </SettingsRow>
        <SettingsRow label={t('precheck')} description={t('precheckHint')} />
        {agent && (
          <SettingsRow
            label={t('schedule')}
            description={`${t('last')}: ${when(agent.heartbeatLastAt)} · ${t('next')}: ${on ? when(agent.heartbeatNextAt) : '–'}`}
          >
            {on && throttled && <Pill tone="warning">{t('throttled')}</Pill>}
          </SettingsRow>
        )}
      </SettingsGroup>
      {agent && (
        <Stack gap={2}>
          <Text size="xs" tone="muted" weight="medium">
            {t('history')}
          </Text>
          {items.length === 0 ? (
            <Text size="sm" tone="muted">
              {history.isPending ? '…' : t('historyEmpty')}
            </Text>
          ) : (
            <List label={t('history')}>
              {items.map((item) =>
                item.kind === 'queued' ? (
                  <ListRow
                    key={item.event.id}
                    icon={<HeartPulse />}
                    title={t('outcome.queued')}
                    subtitle={item.event.reason}
                    dot="working"
                    meta={when(item.event.checkedAt)}
                  />
                ) : (
                  <ListRow
                    key={item.key}
                    icon={<HeartPulse />}
                    title={
                      item.count > 1
                        ? t('skippedMany', {
                            count: item.count,
                            reason: t(`reasons.${item.reason}`),
                          })
                        : t(`reasons.${item.reason}`)
                    }
                    meta={
                      item.count > 1
                        ? `${time(item.to)} – ${time(item.from)}`
                        : when(item.from)
                    }
                  />
                ),
              )}
            </List>
          )}
        </Stack>
      )}
    </AgentFormSection>
  );
}
