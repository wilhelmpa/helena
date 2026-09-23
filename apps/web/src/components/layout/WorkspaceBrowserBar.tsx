'use client';

import { useState } from 'react';
import { ArrowLeft, ArrowRight, RotateCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useBrowserControl } from '@/hooks/useBrowserControl';
import { Button } from '@/components/ui/button';
import WorkspaceBrowserTabs from './WorkspaceBrowserTabs';

// The project browser's toolbar: back, forward, reload, the address of the tab in front
// and the tab list. It acts on the same browser the agent works in, so the address follows
// the agent's navigation as well as the person's.
export default function WorkspaceBrowserBar({ base }: { base: string }) {
  const t = useTranslations('nav.workspace.browserBar');
  const { tabs, active, act } = useBrowserControl(base);
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
    </div>
  );
}
