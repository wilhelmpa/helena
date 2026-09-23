'use client';

import { useState } from 'react';
import { ArrowLeft, ArrowRight, Bot, Hand, RotateCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useBrowserControl } from '@/hooks/useBrowserControl';
import { useBrowserLock } from '@/hooks/useBrowserLock';
import type { BrowserView } from '@/hooks/useBrowserPreferences';
import { Button } from '@/components/ui/button';
import WorkspaceBrowserTabs from './WorkspaceBrowserTabs';
import WorkspaceBrowserViewSwitch from './WorkspaceBrowserViewSwitch';

// The project browser's toolbar: back, forward, reload, the address of the tab in front,
// the tab list and the choice of view. It acts on the same browser the agent works in, so
// the address follows the agent's navigation as well as the person's.
export default function WorkspaceBrowserBar({
  base,
  view,
  onViewChange,
  followAgent,
  onToggleFollowAgent,
}: {
  base: string;
  view: BrowserView;
  onViewChange: (view: BrowserView) => void;
  followAgent: boolean;
  onToggleFollowAgent: () => void;
}) {
  const t = useTranslations('nav.workspace.browserBar');
  const { tabs, active, act } = useBrowserControl(base);
  const { takeOver, takingOver } = useBrowserLock(base);
  // What the person is typing; null while the field shows the tab's own address.
  const [draft, setDraft] = useState<string | null>(null);
  const id = active?.id;

  return (
    <div className="flex min-w-0 flex-1 items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon"
        className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
        disabled={!id}
        onClick={() => act({ action: 'back', id })}
        title={t('back')}
        aria-label={t('back')}
      >
        <ArrowLeft />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
        disabled={!id}
        onClick={() => act({ action: 'forward', id })}
        title={t('forward')}
        aria-label={t('forward')}
      >
        <ArrowRight />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
        disabled={!id}
        onClick={() => act({ action: 'reload', id })}
        title={t('reload')}
        aria-label={t('reload')}
      >
        <RotateCw />
      </Button>
      <form
        className="min-w-0 flex-1"
        onSubmit={(event) => {
          event.preventDefault();
          if (!draft?.trim()) return;
          if (id) act({ action: 'navigate', id, url: draft });
          else act({ action: 'new', url: draft });
          setDraft(null);
        }}
      >
        <input
          aria-label={t('address')}
          placeholder={t('address')}
          dir="ltr"
          spellCheck={false}
          className="h-7 w-full rounded-md border bg-muted/40 px-2 text-xs outline-none focus:bg-background focus-visible:ring-[3px] focus-visible:ring-ring/50"
          value={draft ?? active?.url ?? ''}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          onBlur={() => setDraft(null)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setDraft(null);
              event.currentTarget.blur();
            }
          }}
        />
      </form>
      <WorkspaceBrowserTabs
        tabs={tabs}
        onActivate={(tabId) => act({ action: 'activate', id: tabId })}
        onClose={(tabId) => act({ action: 'close', id: tabId })}
        onNew={() => act({ action: 'new' })}
      />
      {view === 'live' && (
        <>
          <Button
            variant={followAgent ? 'secondary' : 'ghost'}
            size="icon"
            className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
            aria-pressed={followAgent}
            onClick={onToggleFollowAgent}
            title={followAgent ? t('followAgentOn') : t('followAgentOff')}
            aria-label={followAgent ? t('followAgentOn') : t('followAgentOff')}
          >
            <Bot />
          </Button>
          {/* Quick-access Übernehmen (design §5): always reachable here regardless of who the
              toolbar itself currently knows is in control (unlike the live view's own banner,
              this bar does not track the control lock's state) — a harmless action to take
              even while the owner already has it. */}
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
            disabled={takingOver}
            onClick={() => takeOver()}
            title={t('takeOver')}
            aria-label={t('takeOver')}
          >
            <Hand />
          </Button>
        </>
      )}
      <WorkspaceBrowserViewSwitch view={view} onChange={onViewChange} />
    </div>
  );
}
