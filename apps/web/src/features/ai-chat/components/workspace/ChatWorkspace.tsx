'use client';

import WebLinkScope from '@/components/common/WebLinkScope';
import { useCallback, useRef, useState } from 'react';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import { chatScopeKey } from '@/lib/api/endpoints/agentChat';
import { useAiAgentQuery } from '@/services/aiAgents.service';
import { Skeleton } from '@/components/ui/skeleton';
import { useContainerWidth } from '../../hooks/useContainerWidth';
import { useChatAgentStates } from '../../hooks/useChatAgentStates';
import { useChatSummary } from '../../hooks/useChatSummary';
import { artifactPlacement, chatLayoutMode } from '../../utils/chatLayout';
import type { Artifact } from '../../utils/artifacts';
import { locationAfterDeletion, type ChatLocation } from '../../utils/chatLocation';
import { newChatScopeKey } from '../../utils/contextAgents';
import ChatListPane from './ChatListPane';
import ChatThreadView from './ChatThreadView';
import ChatEmptyState from './ChatEmptyState';
import ArtifactPanel from './ArtifactPanel';

export interface ChatWorkspaceProps {
  scopeKey: string;
  // For useAiAgentQuery's fallback lookup below — null only while the scope itself is
  // still resolving, in which case there is nothing to look up yet anyway.
  teamId: number | null;
  projectKey: string | null;
  agents: AiAgent[];
  // Controlled: the caller owns where "here" is — the URL for the full page
  // (ChatWorkspaceRoot), local state for the tool panel (panel/NativeChatWorkspace) —
  // so the same component works whether or not it owns the address bar. `replace` asks
  // for no new history entry: a new chat getting its thread id is the same place.
  location: ChatLocation;
  onNavigate: (next: ChatLocation, options?: { replace?: boolean }) => void;
  onActivity?: (next: ChatLocation) => void;
  // The chat page, not the tool panel: the conversation's bar joins the app header.
  inPage?: boolean;
  pageContext?: { projectKey: string | null; path: string };
}

// The claude.ai-style chat: a chat list, the open conversation with its composer, and
// an artifact panel — a container query away from becoming a narrow drawer-and-overlay
// layout instead of three columns, so the same component reads correctly full page, in
// a split view, in the tool panel and on a phone. One agent per chat: a new chat starts
// by choosing who it is with (ChatNewChatIntro), and choosing another agent later starts
// another chat (ChatAgentMenu) — it never becomes a group chat.
export default function ChatWorkspace({
  scopeKey,
  teamId,
  projectKey,
  agents,
  location,
  onNavigate,
  onActivity,
  inPage = false,
  pageContext,
}: ChatWorkspaceProps) {
  const [rootRef, width] = useContainerWidth<HTMLDivElement>();
  const [listOpen, setListOpen] = useState(false);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [artifactOpen, setArtifactOpen] = useState(false);
  const states = useChatAgentStates(agents);
  // What was typed into a new chat before its agent was picked: picking remounts the
  // view (another agent, another chat), and the text should come along.
  const newChatDraft = useRef('');

  const defaultAgentId = agents[0]?.id ?? null;
  const agentId = location.agentId ?? defaultAgentId;
  const threadId = location.threadId;

  // The thread view is remounted for every other chat, but not when a new chat is given
  // its thread id by its own first answer: remounting then would drop the answer that is
  // streaming in.
  const [adoptedThreadId, setAdoptedThreadId] = useState<string | null>(null);
  const [view, setView] = useState({ agentId, threadId, session: 0 });
  if (view.agentId !== agentId || view.threadId !== threadId) {
    const adopted =
      view.agentId === agentId &&
      view.threadId == null &&
      threadId != null &&
      threadId === adoptedThreadId;
    setView({ agentId, threadId, session: adopted ? view.session : view.session + 1 });
  }

  const closePanels = useCallback(() => {
    setArtifact(null);
    setArtifactOpen(false);
    setListOpen(false);
  }, []);

  const selectThread = useCallback(
    (thread: { id: string; agentId: number }) => {
      closePanels();
      onNavigate({ agentId: thread.agentId, threadId: thread.id });
    },
    [closePanels, onNavigate],
  );

  const startNewChat = useCallback(
    (newAgentId: number | null) => {
      closePanels();
      onNavigate({ agentId: newAgentId ?? agentId, threadId: null });
    },
    [closePanels, onNavigate, agentId],
  );

  const onThreadCreated = useCallback(
    (newThreadId: string) => {
      if (newThreadId === threadId) return;
      setAdoptedThreadId(newThreadId);
      onNavigate({ agentId, threadId: newThreadId }, { replace: true });
    },
    [onNavigate, agentId, threadId],
  );

  const markThreadActive = useCallback(
    (activeThreadId: string) => {
      if (threadId === activeThreadId) onActivity?.({ agentId, threadId: activeThreadId });
    },
    [agentId, threadId, onActivity],
  );

  // A deleted thread never stays open: the view leaves it (its chat state and cached
  // transcript go with the remounted view), and the address loses it.
  const leaveDeletedThread = useCallback(
    (deletedThreadId: string) => {
      const next = locationAfterDeletion({ agentId, threadId }, deletedThreadId);
      if (!next) return;
      closePanels();
      onNavigate(next, { replace: true });
    },
    [agentId, threadId, closePanels, onNavigate],
  );

  const showArtifact = useCallback((next: Artifact) => {
    setArtifact(next);
    setArtifactOpen(true);
  }, []);

  // Before the first measurement (width 0) the layout is compact: the split layout
  // hides the list behind its own container query, so guessing "wide" while narrow would
  // leave the list button with nothing to open until the width arrives.
  const mode = inPage && projectKey === null ? 'compact' : chatLayoutMode(width);
  const agentInScope = agents.find((agent) => agent.id === agentId) ?? null;
  // The agent a thread belongs to is not always one this workspace's picker offers
  // (one working in another project, or one the list has not loaded yet): it is read
  // directly rather than silently showing no chat and never loading the thread.
  const fallbackAgent = useAiAgentQuery(teamId, agentInScope || agentId == null ? null : agentId);
  const selectedAgent = agentInScope ?? fallbackAgent.data ?? null;
  // A thread keeps the scope it was started in — the Home list also holds the member's
  // project chats, and a reply goes through that project's route (the API refuses a
  // thread of another scope). A new chat is this workspace's, including once its first
  // answer gave it an id.
  const summary = useChatSummary(threadId);
  // A new chat with an agent of one project runs in that project, even from Helena's panel.
  const threadScopeKey =
    threadId != null && threadId !== adoptedThreadId && summary.data
      ? chatScopeKey(summary.data)
      : newChatScopeKey(scopeKey, selectedAgent);
  const resolvingThread =
    threadId != null && threadId !== adoptedThreadId && !summary.data && summary.isLoading;
  let linkProjectKey: string | null | undefined;
  if (!resolvingThread) linkProjectKey = threadScopeKey.startsWith('team:') ? null : threadScopeKey;
  const resolvingAgent =
    (agentId != null && !agentInScope && fallbackAgent.isLoading) || resolvingThread;

  return (
    <div
      ref={rootRef}
      className="@container/chat relative flex h-full min-h-0 flex-1 overflow-hidden"
    >
      <ChatListPane
        projectKey={projectKey}
        agents={agents}
        mode={mode}
        side={inPage && projectKey === null ? 'end' : 'start'}
        open={listOpen}
        onOpenChange={setListOpen}
        selectedThreadId={threadId}
        onSelectThread={selectThread}
        onThreadRemoved={leaveDeletedThread}
        onNewChat={() => startNewChat(null)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {selectedAgent && !resolvingThread ? (
          <ChatThreadView
            key={`${agentId}:${view.session}`}
            scopeKey={threadScopeKey}
            projectKey={projectKey}
            agent={selectedAgent}
            agents={agents}
            states={states}
            threadId={threadId}
            newChatDraft={newChatDraft}
            onThreadCreated={onThreadCreated}
            onActivity={markThreadActive}
            onThreadDeleted={leaveDeletedThread}
            onNewChat={startNewChat}
            onOpenList={() => setListOpen(true)}
            compact={mode === 'compact'}
            onArtifact={showArtifact}
            artifactOpen={artifactOpen}
            onToggleArtifact={() => setArtifactOpen((open) => !open)}
            hasArtifact={artifact != null}
            inPage={inPage}
            pageContext={pageContext}
          />
        ) : resolvingAgent ? (
          <div className="flex h-full min-h-0 flex-col gap-3 p-4">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-full w-full flex-1" />
          </div>
        ) : (
          <ChatEmptyState
            teamId={teamId}
            compact={mode === 'compact'}
            onOpenList={() => setListOpen(true)}
          />
        )}
      </div>
      <WebLinkScope projectKey={linkProjectKey}>
        <ArtifactPanel
          artifact={artifact}
          open={artifactOpen}
          onClose={() => setArtifactOpen(false)}
          overlay={width > 0 && artifactPlacement(width) === 'overlay'}
          scopeKey={threadScopeKey}
        />
      </WebLinkScope>
    </div>
  );
}
