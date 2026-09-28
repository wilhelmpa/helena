'use client';

import { usePathname } from 'next/navigation';
import { Plus } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import Orb from '@/components/helena/Orb';
import { useAgentStatus } from '@/utils/helenaStatus';
import { useChatWorkspaceScope } from '@/features/ai-chat/hooks/useChatWorkspaceScope';
import { requestDockVoice } from '@/features/voice/utils/dockVoice';

export default function HomeDock({
  open,
  onOpen,
  onNewIssue,
}: {
  open: boolean;
  onOpen: () => void;
  onNewIssue?: () => void;
}) {
  const pathname = usePathname();
  const t = useTranslations('nav');
  const tIssue = useTranslations('workItems');
  const home = useChatWorkspaceScope(null);
  const status = useAgentStatus(home.agents[0]?.id ?? 0);
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
    <>
      {onNewIssue && (
        <button
          type="button"
          className="helena-home-dock-plus"
          aria-label={tIssue('newIssue')}
          title={tIssue('newIssue')}
          onClick={onNewIssue}
        >
          <Plus size={24} />
        </button>
      )}
      <button
        type="button"
        className="helena-home-dock"
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
        <Orb state={status} size="medium" />
      </button>
    </>
  );
}
