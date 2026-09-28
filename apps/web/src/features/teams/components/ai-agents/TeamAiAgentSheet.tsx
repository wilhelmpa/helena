'use client';

import { useState } from 'react';
import { Bot, MessageSquare, Settings2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PAGE_CONTROL_ACTIVE_CLASS, PAGE_CONTROL_CLASS } from '@/components/layout/PageToolbar';
import { agentTabsFor } from '@/features/agent-runtime/agentTabs';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import { useAiAgentsQuery } from '@/services/aiAgents.service';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import AgentTestChat from '@/features/ai-chat/components/panel/AgentTestChat';
import { useAgentCan, useAgentSection } from '../../context/agentSection';
import { AgentSheetForm } from './AgentSheetForm';

const SETTINGS_TAB = 'settings';
import { useTranslations } from 'next-intl';

// Full-width sheet for one agent. Opened for create (agent null) or to edit an
// existing one. Create and edit share the same form (AgentSheetForm): on create the
// sheet stays open and switches to editing the new agent. Beside the form sits the chat
// (the same one as everywhere else) to try the agent out.
export function TeamAiAgentSheet({
  open,
  agent,
  projectId,
  onClose,
  initialOpenSection,
  initialTab,
  initialRunId,
}: {
  open: boolean;
  agent: AiAgent | null;
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
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      {/* The built-in close button is pinned to the far top-right corner, which drifts
          away from the header controls at full width. Hide it (it is the only direct
          <button> child of SheetContent) and render our own in the header. */}
      {/* duration-0 cancels the slide-in/out animation from SheetContent so the
          full-screen editor appears at once instead of sliding in from the right. */}
      <SheetContent
        side="right"
        className="w-full gap-0 p-0 duration-0 data-[state=closed]:duration-0 data-[state=open]:duration-0 sm:max-w-none [&>button]:hidden"
      >
        {/* Key by agent (or 'new' for create) so switching gives a fresh form and chat
            session; create keeps the 'new' key while it becomes edit, so no remount. */}
        {open && (
          <SheetBody
            key={agent?.id ?? 'new'}
            initialAgent={agent}
            projectId={projectId}
            initialOpenSection={initialOpenSection}
            initialTab={initialTab}
            initialRunId={initialRunId ?? null}
          />
        )}
      </SheetContent>
    </Sheet>
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
  initialOpenSection,
  initialTab,
  initialRunId,
  inModal = false,
}: {
  initialAgent: AiAgent | null;
  projectId?: number;
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
  const [tab, setTab] = useState(initialTab ?? SETTINGS_TAB);
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

      {agent && tabs.length > 0 && (
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
