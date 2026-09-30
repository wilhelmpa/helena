'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Orb } from '@/design-system';
import { useAgentStatus } from '@/utils/helenaStatus';
import { useAgentWorkStates } from '@/hooks/useAgentWorkStates';
import { useMainChat } from '@/features/ai-chat/hooks/useMainChat';
import type { ChatThreadRequest } from '@/context/shellContext';
import { requestDockVoice } from '@/features/voice/utils/dockVoice';

// Bottom right there is only the orb (owner, 28.09.): the real voice orb (Shipnotes
// particles, WebGL; a still orb in the same look while the tab is hidden or motion is
// reduced) in the status of the place's main agent. A click opens the chat with that agent
// in the panel — in a project its coordinator, in Home Ava, never a picker first (owner,
// O105; the agent is switched in the composer) —, a long press starts voice. It is hidden on
// the Home start page, where the orb is the page, and on the terminals page.
export default function HomeDock({
  open,
  projectKey,
  onOpen,
}: {
  open: boolean;
  projectKey: string | null;
  onOpen: (chat: ChatThreadRequest | null) => void;
}) {
  const pathname = usePathname();
  const t = useTranslations('nav');
  const main = useMainChat(projectKey);
  const mainId = main.agent?.id ?? 0;
  // The dock stands for the main agent's chat: its orb rests while the agent works elsewhere
  // (other chats, runs, the local model busy for others — owner, 28.09.) and only asks for the
  // owner when a run of hers waits for him.
  const waiting = useAgentWorkStates().get(mainId) === 'waiting';
  const status = useAgentStatus(mainId, { run: waiting ? 'waiting' : null });
  const openMain = () => onOpen(main.location);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearHold = () => {
    if (hold.current) clearTimeout(hold.current);
    hold.current = null;
  };
  useEffect(
    () => () => {
      if (hold.current) clearTimeout(hold.current);
    },
    [],
  );
  // Hidden where the orb is the page (Home) and over the terminals, whose last line and key
  // bar it would cover.
  if (pathname === '/' || pathname === '/terminals' || open) return null;
  return (
    <button
      type="button"
      className="ds-dock"
      aria-label={t('dockOpen')}
      title={t('dockOpen')}
      onClick={openMain}
      onPointerDown={() => {
        clearHold();
        hold.current = setTimeout(() => {
          openMain();
          requestDockVoice();
          hold.current = null;
        }, 650);
      }}
      onPointerUp={clearHold}
      onPointerCancel={clearHold}
    >
      <Orb state={status} size="large" />
    </button>
  );
}
