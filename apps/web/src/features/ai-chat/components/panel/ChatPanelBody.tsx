'use client';

import { memo, useEffect } from 'react';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import { useProjectAgents } from '@/hooks/useProjectAgents';
import { AiChatThreadSkeleton } from '../shared/AiChatThreadSkeleton';
import { ChatPanelEmpty } from './ChatPanelEmpty';
import { ChatPanelSession } from './ChatPanelSession';
import { ChatPanelTabs } from './ChatPanelTabs';
import { useChatSessions, type ChatSession } from '../../hooks/useChatSessions';
import { useProviderLabel } from '../../hooks/useProviderLabel';

// What the chat panel holds under its header: the open sessions and the tab row over
// them. Memoised because resizing the panel re-renders it on every pointer move, and a
// render here reaches every transcript.
export const ChatPanelBody = memo(function ChatPanelBody({
  projectKey,
  newChatAgentId,
  onNewChatHandled,
  agents: suppliedAgents,
  agentsLoading,
}: {
  projectKey: string;
  newChatAgentId: number | null;
  onNewChatHandled: () => void;
  agents?: AiAgent[];
  agentsLoading?: boolean;
}) {
  const agentsQuery = useProjectAgents();
  const agents = suppliedAgents ?? agentsQuery.data ?? [];
  const providerLabel = useProviderLabel();
  const {
    sessions,
    active,
    setActive,
    newTab,
    openTab,
    openThread,
    closeSession,
    moveTab,
    swapTabs,
    setThread,
    setAgent,
    setState,
  } = useChatSessions(projectKey, agents[0]?.id ?? null);

  // A page asked for a chat with one agent: it opens as a tab of its own, so whatever
  // is already open stays.
  useEffect(() => {
    if (newChatAgentId == null) return;
    openTab(newChatAgentId);
    onNewChatHandled();
  }, [newChatAgentId, openTab, onNewChatHandled]);

  // A session that has said nothing changes its agent in place; one with a transcript
  // keeps it, and the other agent is chatted with in a tab of its own.
  const selectAgent = (session: ChatSession, agentId: number) => {
    if (agentId === session.agentId) return;
    if (session.hasMessages) openTab(agentId);
    else setAgent(session.id, agentId);
  };

  // A conversation that is deleted from the history cannot be shown any more.
  const handleThreadDeleted = (threadId: string) => {
    const session = sessions.find((candidate) => candidate.threadId === threadId);
    if (session) closeSession(session.id);
  };

  if (agentsLoading ?? agentsQuery.isLoading) {
    return (
      <div className="min-h-0 flex-1">
        <AiChatThreadSkeleton />
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div className="min-h-0 flex-1">
        <ChatPanelEmpty projectKey={projectKey} />
      </div>
    );
  }

  return (
    <>
      <ChatPanelTabs
        projectKey={projectKey}
        sessions={sessions}
        activeId={active?.id ?? null}
        onSelect={setActive}
        onClose={closeSession}
        onNewTab={newTab}
        onMoveTab={moveTab}
        onSwapTabs={swapTabs}
      />

      <div className="relative min-h-0 flex-1">
        {sessions.map((session) => {
          const agent = agents.find((candidate) => candidate.id === session.agentId);
          if (!agent) return null;
          return (
            <ChatPanelSession
              key={session.id}
              projectKey={projectKey}
              agents={agents}
              agent={agent}
              session={session}
              active={session.id === active?.id}
              providerLabel={providerLabel}
              onThreadCreated={setThread}
              onStateChange={setState}
              onSelectAgent={selectAgent}
              onSelectThread={openThread}
              onThreadDeleted={handleThreadDeleted}
            />
          );
        })}
      </div>
    </>
  );
});
