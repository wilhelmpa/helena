'use client';

import { ChevronDown, ChevronUp, PanelTop } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { IconButton } from '@/design-system';
import Orb from '@/components/helena/Orb';
import type { HelenaStatus } from '@/utils/helenaStatus';
import type { ChatDockState } from '@/context/chatDock';

// The one line over the composer while the chat waits behind another tab (Auftrag 116):
// the orb of this chat, the last answer in one line (or, open, who the chat is with),
// open/close and "back to the chat tab". A click on the line opens the chat area.
export default function ChatDockBar({
  dock,
  agentName,
  lastAnswer,
  status,
}: {
  dock: ChatDockState;
  agentName: string;
  // The last answer as plain text, or null before the first one.
  lastAnswer: string | null;
  status: HelenaStatus;
}) {
  const t = useTranslations('chatWorkspace.dock');
  const line = dock.expanded ? agentName : (lastAnswer ?? t('empty', { agent: agentName }));
  return (
    <div className="ds-chat-dock-bar" data-state={dock.expanded ? 'expanded' : 'collapsed'}>
      <button
        type="button"
        className="ds-chat-dock-line"
        onClick={dock.onToggle}
        aria-expanded={dock.expanded}
        title={dock.expanded ? t('collapse') : t('expand')}
      >
        <Orb state={status} size="dot" />
        <span className="ds-chat-dock-text" data-tone={dock.expanded ? 'name' : 'answer'}>
          {line}
        </span>
      </button>
      <IconButton
        size="small"
        label={dock.expanded ? t('collapse') : t('expand')}
        onClick={dock.onToggle}
      >
        {dock.expanded ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
      </IconButton>
      <IconButton size="small" label={t('openTab')} onClick={dock.onOpenTab}>
        <PanelTop size={15} />
      </IconButton>
    </div>
  );
}
