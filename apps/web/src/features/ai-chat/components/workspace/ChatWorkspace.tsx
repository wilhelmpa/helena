'use client';

import { useCallback, useState } from 'react';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import { useAiAgentQuery } from '@/services/aiAgents.service';
import { Skeleton } from '@/components/ui/skeleton';
import { useContainerWidth } from '../../hooks/useContainerWidth';
import { artifactPlacement, chatLayoutMode } from '../../utils/chatLayout';
import type { Artifact } from '../../utils/artifacts';
import ChatListPane from './ChatListPane';
import ChatThreadView from './ChatThreadView';
import ChatEmptyState from './ChatEmptyState';
import ArtifactPanel from './ArtifactPanel';

export interface ChatLocation {
  agentId: number | null;
  threadId: string | null;
}

export interface ChatWorkspaceProps {
  scopeKey: string;
  // For useAiAgentQuery's fallback lookup below — null only while the scope itself is
  // still resolving, in which case there is nothing to look up yet anyway.
  teamId: number | null;
  projectKey: string | null;
  agents: AiAgent[];
  // Controlled: the caller owns where "here" is — the URL for the full page
  // (ChatWorkspaceRoot), local state for the tool panel (panel/NativeChatWorkspace) —
  // so the same component works whether or not it owns the address bar.
  location: ChatLocation;
  onNavigate: (next: ChatLocation) => void;
}

// The claude.ai-style chat: a chat list, the open conversation with its composer, and
// an artifact panel — a container query away from becoming a narrow drawer-and-overlay
// layout instead of three columns, so the same component reads correctly full page, in
// a split view, or in the tool panel. One agent per chat; picking an agent starts a new
// one (see NewChatAgentPicker), it never becomes a group chat.
export default function ChatWorkspace({
  scopeKey,
  teamId,
  projectKey,
  agents,
  location,
  onNavigate,
}: ChatWorkspaceProps) {
  const [rootRef, width] = useContainerWidth<HTMLDivElement>();
  const [listOpen, setListOpen] = useState(false);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [artifactOpen, setArtifactOpen] = useState(false);

  const agentId = location.agentId ?? agents[0]?.id ?? null;
  const threadId = location.threadId;

  const go = useCallback(
    (next: Partial<ChatLocation>) => {
      onNavigate({
        agentId: next.agentId !== undefined ? next.agentId : agentId,
        threadId: next.threadId !== undefined ? next.threadId : threadId,
      });
    },
    [onNavigate, agentId, threadId],
  );

  const selectThread = useCallback(
    (thread: { id: string; agentId: number }) => {
      setArtifact(null);
      setArtifactOpen(false);
      setListOpen(false);
      go({ agentId: thread.agentId, threadId: thread.id });
    },
    [go],
  );

  const startNewChat = useCallback(
    (newAgentId: number) => {
      setArtifact(null);
      setArtifactOpen(false);
      setListOpen(false);
      go({ agentId: newAgentId, threadId: null });
    },
    [go],
  );

  const onThreadCreated = useCallback(
    (newThreadId: string) => {
      if (newThreadId !== threadId) go({ threadId: newThreadId });
    },
    [go, threadId],
  );

  const showArtifact = useCallback((next: Artifact) => {
    setArtifact(next);
    setArtifactOpen(true);
  }, []);

  const mode = chatLayoutMode(width || 1024);
  const agentInScope = agents.find((agent) => agent.id === agentId) ?? null;
  // The agent a thread belongs to is not always one this workspace's own picker
  // offers (a template, one filtered out for some other reason, or simply one the
  // picker has not loaded yet): fetched directly rather than silently falling back
  // to "no chat open" and never even asking for the thread's messages. Only tried
  // once a specific agent is actually wanted and the picker's own list did not carry
  // it — never while nothing is selected at all.
  const fallbackAgent = useAiAgentQuery(teamId, agentInScope || agentId == null ? null : agentId);
  const selectedAgent = agentInScope ?? fallbackAgent.data ?? null;
  const resolvingAgent = agentId != null && !agentInScope && fallbackAgent.isLoading;

  return (
    <div ref={rootRef} className="@container/chat flex h-full min-h-0 flex-1 overflow-hidden">
      <ChatListPane
        scopeKey={scopeKey}
        projectKey={projectKey}
        agents={agents}
        mode={mode}
        open={listOpen}
        onOpenChange={setListOpen}
        selectedThreadId={threadId}
        onSelectThread={selectThread}
        onNewChat={startNewChat}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {selectedAgent ? (
          <ChatThreadView
            key={`${agentId}:${threadId ?? 'new'}`}
            scopeKey={scopeKey}
            projectKey={projectKey}
            agent={selectedAgent}
            threadId={threadId}
            onThreadCreated={onThreadCreated}
            onNewChat={() => startNewChat(selectedAgent.id)}
            onOpenList={() => setListOpen(true)}
            compact={mode === 'compact'}
            onArtifact={showArtifact}
            artifactOpen={artifactOpen}
            onToggleArtifact={() => setArtifactOpen((open) => !open)}
            hasArtifact={artifact != null}
          />
        ) : resolvingAgent ? (
          <div className="flex h-full min-h-0 flex-col gap-3 p-4">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-full w-full flex-1" />
          </div>
        ) : (
          <ChatEmptyState
            agents={agents}
            onPick={startNewChat}
            onOpenList={() => setListOpen(true)}
          />
        )}
      </div>
      <ArtifactPanel
        artifact={artifact}
        open={artifactOpen}
        onClose={() => setArtifactOpen(false)}
        overlay={width > 0 && artifactPlacement(width) === 'overlay'}
        scopeKey={scopeKey}
      />
    </div>
  );
}
