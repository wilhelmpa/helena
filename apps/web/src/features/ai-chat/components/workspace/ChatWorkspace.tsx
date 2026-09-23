'use client';

import { useCallback, useState } from 'react';
import type { AiAgent } from '@/lib/api/endpoints/agents';
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

  // The thread view is remounted for every other chat, but not when a new chat is given
  // its thread id by its own first answer: remounting then would drop the answer that is
  // streaming in, and closing its stream tells the API to stop it.
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
      if (newThreadId === threadId) return;
      setAdoptedThreadId(newThreadId);
      go({ threadId: newThreadId });
    },
    [go, threadId],
  );

  const showArtifact = useCallback((next: Artifact) => {
    setArtifact(next);
    setArtifactOpen(true);
  }, []);

  const mode = chatLayoutMode(width || 1024);
  const selectedAgent = agents.find((agent) => agent.id === agentId) ?? null;

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
            key={`${agentId}:${view.session}`}
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
