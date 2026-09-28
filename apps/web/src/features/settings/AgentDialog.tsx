'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTeamsQuery } from '@/services/teams.service';
import { useAiAgentsQuery } from '@/services/aiAgents.service';
import { ShellHeaderActionsSlotCtx, ShellHeaderSlotCtx } from '@/context/shellHeaderSlot';
import { Modal, Orb } from '@/design-system';
import { useAgentStatus } from '@/utils/helenaStatus';
import AgentSettingsModalContent from './AgentSettingsModalContent';
import { AGENT_DIALOG_OPEN, AGENT_PARAM } from './settingsModalCatalog';

let pushedEntry = false;

function hrefWith(agentId: number | null) {
  const url = new URL(window.location.href);
  if (agentId == null) {
    url.searchParams.delete(AGENT_PARAM);
    url.searchParams.delete('agentTab');
    url.searchParams.delete('agentRunId');
  } else url.searchParams.set(AGENT_PARAM, String(agentId));
  return `${url.pathname}${url.search}${url.hash}`;
}

function AgentHeading({
  agentId,
  name,
  detail,
}: {
  agentId: number;
  name: string;
  detail: string;
}) {
  const status = useAgentStatus(agentId);
  return (
    <div className="ds-agent-dialog-head">
      <Orb state={status} size="small" />
      <div>
        <strong>{name}</strong>
        {detail && <span>{detail}</span>}
      </div>
    </div>
  );
}

// An agent's settings in the large dialog (docs/design-system.md §3, owner 28.09.): opened
// from the org chart, the team list or a chat, over the page the user is on — the page
// behind never moves or reloads. It shows all of the agent's settings (execution, model,
// instructions, skills, tools …) and saves as before. Where it stands is `?agent=<id>` in
// the URL, set without navigation, so a reload keeps it open.
export default function AgentDialog() {
  const t = useTranslations('settings.modal');
  const params = useSearchParams();
  const fromUrl = Number(params.get(AGENT_PARAM)) || null;
  const [teamHint, setTeamHint] = useState<number | null>(null);
  const teams = useTeamsQuery().data ?? [];
  const teamId = teamHint ?? teams[0]?.id ?? null;
  const agents = useAiAgentsQuery(fromUrl != null ? teamId : null).data ?? [];
  const agent = agents.find((entry) => entry.id === fromUrl);

  const go = useCallback((agentId: number | null) => {
    const href = hrefWith(agentId);
    if (agentId == null && pushedEntry) {
      pushedEntry = false;
      window.history.back();
      return;
    }
    if (agentId != null && !new URLSearchParams(window.location.search).has(AGENT_PARAM)) {
      pushedEntry = true;
      window.history.pushState(null, '', href);
      return;
    }
    window.history.replaceState(null, '', href);
  }, []);

  useEffect(() => {
    function onOpen(event: Event) {
      const detail = (event as CustomEvent<{ agentId: number; teamId?: number }>).detail;
      if (!detail) return;
      if (detail.teamId) setTeamHint(detail.teamId);
      go(detail.agentId);
    }
    window.addEventListener(AGENT_DIALOG_OPEN, onOpen);
    return () => window.removeEventListener(AGENT_DIALOG_OPEN, onOpen);
  }, [go]);

  // The old agent page linked a tab and a run as `tab`/`run` (/agents?agent=7&tab=runs&run=1).
  const legacy = (key: string) =>
    typeof window !== 'undefined' && window.location.pathname.startsWith('/agents')
      ? params.get(key)
      : null;

  if (fromUrl == null || teamId == null) return null;
  return (
    <Modal
      open
      label={agent?.name ?? t('title')}
      onClose={() => go(null)}
      testId="agent-dialog"
      header={
        <AgentHeading
          agentId={fromUrl}
          name={agent?.name ?? '…'}
          detail={agent?.username ? `@${agent.username}` : ''}
        />
      }
    >
      <ShellHeaderSlotCtx.Provider value={null}>
        <ShellHeaderActionsSlotCtx.Provider value={null}>
          <div className="ds-agent-dialog-body">
            <AgentSettingsModalContent
              teamId={teamId}
              agentId={fromUrl}
              tab={params.get('agentTab') ?? legacy('tab') ?? undefined}
              runId={Number(params.get('agentRunId') ?? legacy('run')) || null}
            />
          </div>
        </ShellHeaderActionsSlotCtx.Provider>
      </ShellHeaderSlotCtx.Provider>
    </Modal>
  );
}
