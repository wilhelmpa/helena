'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, Plus } from 'lucide-react';
import Orb from '@/components/helena/Orb';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { aiAgentsPath, aiTeamPath, filesPath, notesPath } from '@/utils/paths';
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
  const router = useRouter();
  const projectKey = pathname.match(/^\/project\/([^/]+)/)?.[1] ?? null;
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
    <div className="helena-home-dock-actions">
      {onNewIssue && (
        <div className="relative">
          <button
            type="button"
            className="helena-home-dock-create"
            aria-label={tIssue('newIssue')}
            title={tIssue('newIssue')}
            onClick={onNewIssue}
          >
            <Plus size={22} strokeWidth={2.5} />
          </button>
          {projectKey && (
            <Popover>
              <PopoverTrigger asChild>
                <button type="button" aria-label="Weitere erstellen" className="create-dock-arrow absolute -end-1 -bottom-1 flex size-6 items-center justify-center rounded-full">
                  <ChevronDown className="size-3" />
                </button>
              </PopoverTrigger>
              <PopoverContent side="top" align="end" className="w-40 p-1">
                {[
                  { label: 'Doc', href: `${filesPath(projectKey)}?create=doc` },
                  { label: 'Leinwand', href: `${notesPath(projectKey)}&create=canvas` },
                  { label: 'Zeitplan', href: `${aiTeamPath(projectKey, 'schedules')}?create=schedule` },
                  { label: 'Agent', href: `${aiAgentsPath(projectKey)}?create=agent` },
                ].map((option) => (
                  <button key={option.label} type="button" onClick={() => router.push(option.href)} className="flex h-9 w-full items-center rounded-md px-3 text-start text-sm hover:bg-accent">
                    {option.label}
                  </button>
                ))}
              </PopoverContent>
            </Popover>
          )}
        </div>
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
    </div>
  );
}
