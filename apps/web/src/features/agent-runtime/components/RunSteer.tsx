'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button, DetailGroup, Inline, Stack, TextArea } from '@/design-system';
import FollowupModePicker from '@/components/helena/FollowupModePicker';
import FollowupNotes from '@/components/helena/FollowupNotes';
import { useAgentFollowups } from '@/hooks/useAgentFollowups';
import { followupEvent, mergeFollowup } from '@/lib/api/endpoints/agentFollowups';
import type { AgUiEvent } from '@/lib/api/endpoints/agentChat';
import { defaultFollowupMode, orderedModes } from '@/features/ai-chat/utils/followups';
import type { FollowupMode } from '@/lib/api/endpoints/agentFollowups';
import { uuid } from '@/utils/uuid';

// Steering a run that is running — the chat's steering (inject / after / replace), the same
// control and the same notes, for the agent's run: what is written goes to the run in the
// chosen mode, and under it stand the instructions with their status ("wartet" until the
// agent has taken it over). Only the modes the run's runtime offers are shown. The run's own
// events say when an instruction was taken over, so the list follows the live timeline.
export default function RunSteer({
  projectKey,
  agentId,
  runId,
  live,
  events,
  onOpenRun,
}: {
  projectKey: string;
  agentId: number;
  runId: number;
  live: boolean;
  events: AgUiEvent[];
  onOpenRun: (runId: number) => void;
}) {
  const t = useTranslations('agentRuntime.runs');
  const tFollow = useTranslations('chatWorkspace.followups');
  const followups = useAgentFollowups({ scopeKey: projectKey, agentId, kind: 'run', id: runId });
  const items = useMemo(
    () =>
      events.reduce((list, event) => {
        const item = followupEvent(event);
        return item ? mergeFollowup(list, item) : list;
      }, followups.items),
    [events, followups.items],
  );
  const modes = useMemo(() => orderedModes(followups.modes), [followups.modes]);
  const [value, setValue] = useState('');
  const [chosen, setChosen] = useState<FollowupMode | null>(null);
  const mode = chosen && modes.includes(chosen) ? chosen : defaultFollowupMode(modes);
  const steering = live && mode != null;
  if (!steering && items.length === 0) return null;

  const send = async () => {
    const prompt = value.trim();
    if (!prompt || !mode) return;
    try {
      await followups.send({ id: uuid(), prompt, mode });
      setValue('');
    } catch {
      toast.error(tFollow('failed'));
    }
  };

  return (
    <DetailGroup title={t('steerTitle')}>
      <FollowupNotes items={items} onOpenNext={onOpenRun} />
      {steering && (
        <Stack gap={2}>
          <TextArea
            rows={2}
            value={value}
            aria-label={t('steerInstructions')}
            placeholder={t('steerPlaceholder')}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <Inline justify="end">
            <FollowupModePicker modes={modes} mode={mode} onChange={setChosen} showLabel />
            <Button onClick={() => void send()} disabled={!value.trim() || followups.sending}>
              {t('steerSend')}
            </Button>
          </Inline>
        </Stack>
      )}
    </DetailGroup>
  );
}
