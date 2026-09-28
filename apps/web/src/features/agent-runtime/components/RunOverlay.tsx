'use client';

import { useCallback, useEffect, type CSSProperties } from 'react';
import { useSearchParams } from 'next/navigation';
import { Maximize2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTeamsQuery } from '@/services/teams.service';
import { useAiAgentsQuery } from '@/services/aiAgents.service';
import { useExitOnEscape } from '@/hooks/useExitOnEscape';
import { SidePanelResizeHandle, useSidePanelWidth } from '@/design-system';
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
  const t = useTranslations('agentActivity');
  const tCommon = useTranslations('common');
  const params = useSearchParams();
  const target = parseRunParam(params.get(RUN_PARAM));
  const teamId = useTeamsQuery().data?.[0]?.id ?? null;
  const agent = (useAiAgentsQuery(target ? teamId : null).data ?? []).find(
    (entry) => entry.id === target?.agentId,
  );
  const { width } = useSidePanelWidth();

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
  useExitOnEscape(close, target != null);

  if (!target || teamId == null) return null;
  const title = `${agent?.name ?? '…'} · #${target.runId}`;
  return (
    <aside
      aria-label={title}
      className="ds-side-panel ds-issue-overlay"
      data-open="true"
      data-full="false"
      style={{ '--ds-panel-w': `${width}px` } as CSSProperties}
    >
      <SidePanelResizeHandle />
      <div className="ds-panel-head">
        <div className="ds-panel-tabs">
          <div className="ds-panel-tabs-track">
            <div className="ds-panel-tab">
              <span className="ds-panel-tab-select" role="tab" aria-selected="true">
                <span>{title}</span>
              </span>
            </div>
          </div>
        </div>
        <div className="ds-panel-head-tools">
          <button
            type="button"
            className="ds-icon-button"
            onClick={() => {
              // Large: the agent's dialog on its Läufe tab, with this run open.
              const url = new URL(window.location.href);
              url.searchParams.delete(RUN_PARAM);
              url.searchParams.set('agent', String(target.agentId));
              url.searchParams.set('agentTab', 'runs');
              url.searchParams.set('agentRunId', String(target.runId));
              pushedEntry = false;
              window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
            }}
            title={t('openRun')}
            aria-label={t('openRun')}
          >
            <Maximize2 size={15} />
          </button>
          <button
            type="button"
            className="ds-icon-button"
            onClick={close}
            title={tCommon('close')}
            aria-label={tCommon('close')}
          >
            <X size={16} />
          </button>
        </div>
      </div>
      <div className="ds-issue-overlay-body">
        <RunView
          teamId={teamId}
          agentId={target.agentId}
          runId={target.runId}
          onOpenRun={(runId) => go(target.agentId, runId)}
        />
      </div>
    </aside>
  );
}
