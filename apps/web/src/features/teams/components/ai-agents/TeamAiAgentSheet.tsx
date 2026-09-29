'use client';

import { useState } from 'react';
import { Bot, MessageSquare, Settings2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PAGE_CONTROL_ACTIVE_CLASS, PAGE_CONTROL_CLASS } from '@/components/layout/PageToolbar';
import { agentTabsFor } from '@/features/agent-runtime/agentTabs';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import { useAiAgentsQuery } from '@/services/aiAgents.service';
import { SheetClose, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Overlay } from '@/design-system';
import { Button } from '@/components/ui/button';
import AgentTestChat from '@/features/ai-chat/components/panel/AgentTestChat';
import { useAgentCan, useAgentSection } from '../../context/agentSection';
import { AgentSheetForm } from './AgentSheetForm';

import { useTranslations } from 'next-intl';
import { useAgentDialog } from './agentFormPages';

const SETTINGS_TAB = 'settings';

// A new agent (or, from an older caller, one agent) in the one overlay on the right
// (Auftrag 117: an agent never opens as a page of its own): the same form as the agent
// dialog; after "Anlegen" it stays open on the new agent, whose key it shows once.
export function TeamAiAgentSheet({
  open,
  agent,
  projectId,
  asTemplate = false,
  onClose,
  initialOpenSection,
  initialTab,
  initialRunId,
}: {
  open: boolean;
  agent: AiAgent | null;
  // A new template of the pool ("Pool erweitern").
  asTemplate?: boolean;
  // The project a new agent is created in, when the sheet is opened from one.
  projectId?: number;
  onClose: () => void;
  // A section id to open besides the defaults, e.g. from a `/skills` or `/memory` chat
  // command.
  initialOpenSection?: string;
  // The tab to open on (agent-runtime/agentTabs), and a run to show in the runs tab.
  initialTab?: string;
  initialRunId?: number | null;
}) {
  const t = useTranslations('teams.agents');
  if (!open) return null;
  const label = agent ? agent.name : t('newAgent');
  return (
    <Overlay
      label={label}
      tabs={[{ id: 'agent', label }]}
      onClose={onClose}
      className="ds-agent-overlay"
      bodyClassName="is-flush"
      width="wide"
    >
      {/* Keyed by agent (or 'new' for create) so switching gives a fresh form; create keeps
          the 'new' key while it becomes edit, so no remount. */}
      <SheetBody
        key={agent?.id ?? 'new'}
        initialAgent={agent}
        projectId={projectId}
        asTemplate={asTemplate}
        initialOpenSection={initialOpenSection}
        initialTab={initialTab}
        initialRunId={initialRunId ?? null}
        inModal
      />
    </Overlay>
  );
}

// One agent's settings inside the settings modal (openSettings({ scope: 'agent',
// agentId })): the same tabs and form as the sheet, without the sheet's own header and
// the test chat beside it (the modal has its own header, the chat lives in the panel).
export function AgentSettingsBody({
  agent,
  tab,
  runId = null,
}: {
  agent: AiAgent;
  // A tab to open first (e.g. 'runs') and a run to open in it.
  tab?: string;
  runId?: number | null;
}) {
  return (
    <SheetBody key={agent.id} initialAgent={agent} initialTab={tab} initialRunId={runId} inModal />
  );
}

function SheetBody({
  initialAgent,
  projectId,
  asTemplate = false,
  initialOpenSection,
  initialTab,
  initialRunId,
  inModal = false,
}: {
  initialAgent: AiAgent | null;
  projectId?: number;
  asTemplate?: boolean;
  initialOpenSection?: string;
  initialTab?: string;
  initialRunId: number | null;
  inModal?: boolean;
}) {
  const t = useTranslations('teams.agents');
  const tCommon = useTranslations('common');
  const tTabs = useTranslations('agentRuntime.tabs');
  const { teamId } = useAgentSection();
  const canEdit = useAgentCan()('edit');
  const [ownTab, setOwnTab] = useState(initialTab ?? SETTINGS_TAB);
  // In the agent dialog the dialog's head holds the tabs.
  const dialog = useAgentDialog();
  const tab = dialog?.tab ?? ownTab;
  const setTab = dialog?.setTab ?? setOwnTab;
  const [runId, setRunId] = useState<number | null>(initialRunId);
  // The agent just created in this sheet, if any. Once set, the form switches from
  // create to edit for it without remounting.
  const [createdAgent, setCreatedAgent] = useState<AiAgent | null>(null);
  // The create response is a snapshot; re-read the row from the list so a key
  // regenerated in this sheet updates the prefix it shows.
  const agents = useAiAgentsQuery(teamId).data ?? [];
  const created = createdAgent && (agents.find((a) => a.id === createdAgent.id) ?? createdAgent);

  const agent = initialAgent ?? created;
  // A chat is held inside a project, so it runs in the first project the agent works
  // in. An agent attached to none has nothing to chat in.
  const chatProject = agent?.projects[0] ?? null;

  // The form and the test chat always sit side by side, so the sheet keeps its shape
  // from create through edit. There is nothing to chat in until the agent exists and
  // works in a project, and until then the chat side says what is missing.
  // A pool template runs nowhere, so it has no chat.
  const chatReady = !!agent && chatProject != null && !agent.template;
  // The settings stay mounted behind another tab, so what is typed there is kept.
  const tabs = agentTabsFor(agent);
  const activeTab = tabs.find((entry) => entry.id === tab) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!inModal && (
        <div className="flex items-center gap-3 border-b border-border/60 px-4 pt-4 pb-3.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-sidebar-border bg-background text-muted-foreground ring-1 ring-border/60">
            <Bot className="size-4.5" />
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className="min-w-0">
              <SheetTitle className="truncate text-sm">
                {agent ? agent.name : t('newAgent')}
              </SheetTitle>
              <SheetDescription className="truncate text-xs">
                {agent ? `@${agent.username}` : t('sheetSubtitle')}
              </SheetDescription>
            </div>
          </div>
          <SheetClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
              aria-label={tCommon('close')}
            >
              <X className="size-4" />
            </Button>
          </SheetClose>
        </div>
      )}

      {agent && tabs.length > 0 && !dialog && (
        <nav
          aria-label={tTabs('label')}
          className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border/60 px-3 py-1.5"
        >
          {[{ id: SETTINGS_TAB, label: 'settings' as const, icon: Settings2 }, ...tabs].map(
            (entry) => (
              <button
                key={entry.id}
                type="button"
                aria-pressed={tab === entry.id}
                onClick={() => setTab(entry.id)}
                className={cn(
                  PAGE_CONTROL_CLASS,
                  'h-7',
                  tab === entry.id && PAGE_CONTROL_ACTIVE_CLASS,
                )}
              >
                <entry.icon aria-hidden="true" />
                {tTabs(entry.label)}
              </button>
            ),
          )}
        </nav>
      )}

      {agent && activeTab && (
        <activeTab.component
          teamId={teamId}
          agent={agent}
          canEdit={canEdit}
          runId={runId}
          onRunChange={setRunId}
          onOpenRun={(id) => {
            setRunId(id);
            setTab('runs');
          }}
        />
      )}

      <div className={cn('flex min-h-0 flex-1', activeTab && 'hidden')}>
        <div
          className={cn(
            'flex min-h-0 flex-1 basis-0 flex-col',
            !inModal && 'border-e border-border/60',
          )}
        >
          <AgentSheetForm
            agent={agent}
            projectId={projectId}
            asTemplate={asTemplate}
            expanded
            onCreated={setCreatedAgent}
            initialOpenSection={initialOpenSection}
          />
        </div>

        <div className={cn('flex min-h-0 flex-1 basis-0 flex-col', inModal && 'hidden')}>
          {inModal ? null : chatReady ? (
            <AgentTestChat agent={agent} projectKey={chatProject.key} />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
              <MessageSquare className="size-5 text-muted-foreground" />
              <p className="text-sm font-medium">{t('testChat')}</p>
              <p className="max-w-xs text-xs text-muted-foreground">
                {!agent
                  ? t('chatNeedsAgent')
                  : agent.template
                    ? t('chatTemplate')
                    : t('chatNeedsProject')}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
