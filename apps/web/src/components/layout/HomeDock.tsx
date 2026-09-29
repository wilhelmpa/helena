'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Orb } from '@/design-system';
import { useAgentStatus } from '@/utils/helenaStatus';
import { useAgentWorkStates } from '@/hooks/useAgentWorkStates';
import { useChatWorkspaceScope } from '@/features/ai-chat/hooks/useChatWorkspaceScope';
import { requestDockVoice } from '@/features/voice/utils/dockVoice';

// Bottom right there is only the orb (owner, 28.09.): the real voice orb (Shipnotes
// particles, WebGL; a still orb in the same look while the tab is hidden or motion is
// reduced) in the Home agent's status. A click opens the Home chat in the panel, a long
// press starts voice. It is hidden on the Home start page, where the orb is the page.
export default function HomeDock({ open, onOpen }: { open: boolean; onOpen: () => void }) {
  const pathname = usePathname();
  const t = useTranslations('nav');
  const home = useChatWorkspaceScope(null);
  const homeId = home.agents[0]?.id ?? 0;
  // The dock stands for the Home chat: its orb rests while Helena works elsewhere (other
  // chats, runs, the local model busy for others — owner, 28.09.) and only asks for the owner
  // when a run of hers waits for him.
  const waiting = useAgentWorkStates().get(homeId) === 'waiting';
  const status = useAgentStatus(homeId, { run: waiting ? 'waiting' : null });
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
  if (pathname === '/' || open) return null;
  return (
    <button
      type="button"
      className="ds-dock"
      aria-label={t('dockOpen')}
      title={t('dockOpen')}
      onClick={onOpen}
      onPointerDown={() => {
        clearHold();
        hold.current = setTimeout(() => {
          onOpen();
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
