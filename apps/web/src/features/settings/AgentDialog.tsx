'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTeamQuery, useTeamsQuery } from '@/services/teams.service';
import { useAiAgentsQuery } from '@/services/aiAgents.service';
import { ShellHeaderActionsSlotCtx, ShellHeaderSlotCtx } from '@/context/shellHeaderSlot';
import { Orb, Overlay } from '@/design-system';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import { agentTabsFor } from '@/features/agent-runtime/agentTabs';
import {
  AgentDialogCtx,
  agentFormPages,
  type AgentFormPageId,
} from '@/features/teams/components/ai-agents/agentFormPages';
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
    <AgentDialogFrame
      key={fromUrl}
      teamId={teamId}
      agentId={fromUrl}
      agent={agent ?? null}
      label={agent?.name ?? t('title')}
      initialTab={params.get('agentTab') ?? legacy('tab') ?? SETTINGS_TAB}
      runId={Number(params.get('agentRunId') ?? legacy('run')) || null}
      onClose={() => go(null)}
    />
  );
}

const SETTINGS_TAB = 'settings';

// An agent's settings in the one overlay on the right (owner 28.09.: the same overlay as
// a task, a run and a file preview): the tabs Einstellungen, Läufe, Gedächtnis,
// Verbrauch, Laufzeit in its head; on the settings tab the pages of the form in a short,
// grouped list on the left (a row on top when the overlay is narrow) and the page beside
// it. Resizable and full screen like every overlay.
function AgentDialogFrame({
  teamId,
  agentId,
  agent,
  label,
  initialTab,
  runId,
  onClose,
}: {
  teamId: number;
  agentId: number;
  agent: AiAgent | null;
  label: string;
  initialTab: string;
  runId: number | null;
  onClose: () => void;
}) {
  const tTabs = useTranslations('agentRuntime.tabs');
  const tPages = useTranslations('teams.agents.pages');
  const [tab, setTab] = useState(initialTab);
  const [page, setPage] = useState<AgentFormPageId>('general');
  const permissions = useTeamQuery(teamId).data?.permissions;
  const pages = agentFormPages(agent, {
    skills: permissions?.agent_skills.edit ?? false,
    tools: permissions?.agent_tools.edit ?? false,
  });
  const tabs = [
    { value: SETTINGS_TAB, label: tTabs('settings') },
    ...agentTabsFor(agent).map((entry) => ({ value: entry.id, label: tTabs(entry.label) })),
  ];
  const groups = [...new Set(pages.map((entry) => entry.group))];
  const state = useMemo(() => ({ tab, setTab, page, setPage }), [tab, page]);

  return (
    <Overlay
      label={label}
      tabs={tabs.map((entry) => ({ id: entry.value, label: entry.label }))}
      activeTab={tab}
      onTab={setTab}
      onClose={onClose}
      className="ds-agent-overlay"
      bodyClassName="is-flush"
    >
      <ShellHeaderSlotCtx.Provider value={null}>
        <ShellHeaderActionsSlotCtx.Provider value={null}>
          <AgentDialogCtx.Provider value={state}>
            <div className="ds-agent-overlay-top">
              <AgentHeading
                agentId={agentId}
                name={agent?.name ?? '…'}
                detail={agent?.username ? `@${agent.username}` : ''}
              />
            </div>
            <div className={`ds-agent-overlay-main ${tab === SETTINGS_TAB ? '' : 'is-single'}`}>
              {tab === SETTINGS_TAB && (
                <nav className="ds-agent-nav" aria-label={tTabs('settings')}>
                  {groups.map((group) => (
                    <div key={group} className="ds-agent-nav-group">
                      <span className="ds-mono-label">{tPages(`groups.${group}`)}</span>
                      {pages
                        .filter((entry) => entry.group === group)
                        .map((entry) => (
                          <button
                            key={entry.id}
                            type="button"
                            className="ds-agent-nav-item"
                            aria-current={entry.id === page ? 'true' : undefined}
                            onClick={() => setPage(entry.id)}
                          >
                            {tPages(`items.${entry.id}`)}
                          </button>
                        ))}
                    </div>
                  ))}
                </nav>
              )}
              <div className="ds-agent-dialog-body">
                <AgentSettingsModalContent
                  teamId={teamId}
                  agentId={agentId}
                  tab={initialTab}
                  runId={runId}
                />
              </div>
            </div>
          </AgentDialogCtx.Provider>
        </ShellHeaderActionsSlotCtx.Provider>
      </ShellHeaderSlotCtx.Provider>
    </Overlay>
  );
}
