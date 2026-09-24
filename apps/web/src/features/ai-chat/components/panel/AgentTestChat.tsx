'use client';

import { useState } from 'react';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import ChatWorkspace from '../workspace/ChatWorkspace';
import type { ChatLocation } from '../../utils/chatLocation';

// The chat beside an agent's settings (TeamAiAgentSheet), to try how it answers and which
// tools it uses: the same ChatWorkspace as the chat page and the tool panel, held to the
// one agent and the project it works in, with its location kept locally like the
// panel's. Its conversations are ordinary chats and stay in the chat list.
export default function AgentTestChat({
  agent,
  projectKey,
}: {
  agent: AiAgent;
  projectKey: string;
}) {
  const [location, setLocation] = useState<ChatLocation>({ agentId: agent.id, threadId: null });

  return (
    <ChatWorkspace
      scopeKey={projectKey}
      teamId={agent.teamId}
      projectKey={projectKey}
      agents={[agent]}
      location={location}
      onNavigate={setLocation}
    />
  );
}
