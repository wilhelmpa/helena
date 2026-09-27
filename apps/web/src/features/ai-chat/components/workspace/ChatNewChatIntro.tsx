'use client';

import { useTranslations } from 'next-intl';
import type { AiAgent } from '@/lib/api/endpoints/agents';
import AgentStatusOrb from '@/components/common/agent-chat/AgentStatusOrb';
import type { AgentOrbState, VoiceOrbAudio } from '@/utils/agentStatusOrb';

// A new chat before its first message: the selected agent's status and a short introduction. The agent is
// picked in one place only — the dropdown at the composer's bottom left, with its
// state — so there is nothing to choose here.
export default function ChatNewChatIntro({
  agent,
  orbState,
  online,
  motionEnabled,
  conversation,
}: {
  agent: AiAgent;
  orbState: AgentOrbState;
  online: boolean;
  motionEnabled: boolean;
  conversation: VoiceOrbAudio;
}) {
  const t = useTranslations('chatWorkspace');

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 overflow-y-auto px-4 text-center">
      <AgentStatusOrb
        state={
          conversation.phase === 'speaking' ||
          conversation.phase === 'listening' ||
          conversation.phase === 'hearing'
            ? 'idle'
            : conversation.phase === 'thinking' || conversation.phase === 'transcribing'
              ? 'thinking'
              : orbState
        }
        size="large"
        online={online}
        motionEnabled={motionEnabled}
        voicePhase={conversation.phase}
        micStream={conversation.micStream}
        outputAnalyser={conversation.outputAnalyser}
      />
      <p className="text-sm font-medium">{t('newChat.title', { agent: agent.name })}</p>
      <p className="max-w-sm text-xs text-muted-foreground">{t('newChat.hint')}</p>
    </div>
  );
}
