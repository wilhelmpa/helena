'use client';

import { useCallback, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTeamsQuery } from '@/services/teams.service';
import { useAiAgentsQuery } from '@/services/aiAgents.service';
import { Overlay } from '@/design-system';
import { RUN_OVERLAY_OPEN, RUN_PARAM, parseRunParam } from '../runOverlay';
import RunView from './RunView';

let pushedEntry = false;

function hrefWith(value: string | null) {
  const url = new URL(window.location.href);
  if (value == null) url.searchParams.delete(RUN_PARAM);
  else url.searchParams.set(RUN_PARAM, value);
  return `${url.pathname}${url.search}${url.hash}`;
}

// One run of an agent in the overlay on the right (docs/design-system.md §9), opened from
// Verlauf, the dashboard or the inbox over the page the user is on: the same width, handle
// and head as the task overlay; full screen opens it on the agent's Läufe tab.
export default function RunOverlay() {
  const params = useSearchParams();
  const target = parseRunParam(params.get(RUN_PARAM));
  const teamId = useTeamsQuery().data?.[0]?.id ?? null;
  const agent = (useAiAgentsQuery(target ? teamId : null).data ?? []).find(
    (entry) => entry.id === target?.agentId,
  );

  const go = useCallback((agentId: number | null, runId?: number) => {
    const href = hrefWith(agentId == null ? null : `${agentId}.${runId}`);
    if (agentId == null && pushedEntry) {
      pushedEntry = false;
      window.history.back();
      return;
    }
    if (agentId != null && !new URLSearchParams(window.location.search).has(RUN_PARAM)) {
      pushedEntry = true;
      window.history.pushState(null, '', href);
      return;
    }
    window.history.replaceState(null, '', href);
  }, []);

  useEffect(() => {
    function onOpen(event: Event) {
      const detail = (event as CustomEvent<{ agentId: number; runId: number }>).detail;
      if (detail) go(detail.agentId, detail.runId);
    }
    window.addEventListener(RUN_OVERLAY_OPEN, onOpen);
    return () => window.removeEventListener(RUN_OVERLAY_OPEN, onOpen);
  }, [go]);

  const close = () => go(null);

  if (!target || teamId == null) return null;
  const title = `${agent?.name ?? '…'} · #${target.runId}`;
  return (
    <Overlay label={title} tabs={[{ id: 'run', label: title }]} onClose={close}>
      <RunView
        teamId={teamId}
        agentId={target.agentId}
        runId={target.runId}
        onOpenRun={(runId) => go(target.agentId, runId)}
      />
    </Overlay>
  );
}
