'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Bot, BrainCircuit, RotateCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useBrowserControl } from '@/hooks/useBrowserControl';
import { useCaptureWebPageMutation } from '@/services/everything.service';
import type { BrowserView } from '@/hooks/useBrowserPreferences';
import { Button } from '@/components/ui/button';
import WorkspaceBrowserBookmarks from './WorkspaceBrowserBookmarks';
import WorkspaceBrowserStreamMenu from './WorkspaceBrowserStreamMenu';
import WorkspaceBrowserTabs from './WorkspaceBrowserTabs';
import WorkspaceBrowserViewSwitch from './WorkspaceBrowserViewSwitch';

// The project browser's toolbar: back, forward, reload, the address of the tab in front,
// the tab list and the choice of view. It acts on the same browser the agent works in, so
// the address follows the agent's navigation as well as the person's.
export default function WorkspaceBrowserBar({
  base,
  projectKey,
  view,
  onViewChange,
  followAgent,
  onToggleFollowAgent,
}: {
  base: string;
  // The project whose Inbox a saved page goes to; Home's without one.
  projectKey: string | null;
  view: BrowserView;
  onViewChange: (view: BrowserView) => void;
  followAgent: boolean;
  onToggleFollowAgent: () => void;
}) {
  const t = useTranslations('nav.workspace.browserBar');
  const tKnowledge = useTranslations('knowledge.capture');
  const router = useRouter();
  const { tabs, active, act } = useBrowserControl(base);
  // What the person is typing; null while the field shows the tab's own address.
  const [draft, setDraft] = useState<string | null>(null);
  const id = active?.id;
  const savePage = useCaptureWebPageMutation();
  const pageUrl = active?.url && /^https?:\/\//i.test(active.url) ? active.url : null;

  // "Seite im Wissen speichern": the readable part of the page as a Markdown note with
  // its source, in the project's Inbox.
  const save = () => {
    if (!pageUrl) return;
    savePage.mutate(
      { url: pageUrl, projectKey: projectKey ?? undefined },
      {
        onSuccess: (saved) =>
          toast.success(tKnowledge('pageSaved'), {
            action: { label: tKnowledge('open'), onClick: () => router.push(saved.href) },
          }),
        onError: () => toast.error(tKnowledge('pageFailed')),
      },
    );
  };

  return (
    <div className="flex min-w-0 flex-1 items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon"
        className="size-7 shrink-0 text-muted-foreground hover:text-foreground max-sm:hidden"
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
        className="size-7 shrink-0 text-muted-foreground hover:text-foreground max-sm:hidden"
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
          className="h-7 w-full rounded-md border bg-muted/40 px-2 text-sm outline-none focus:bg-background focus-visible:ring-[3px] focus-visible:ring-ring/50"
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
      <WorkspaceBrowserBookmarks
        base={base}
        current={active}
        onOpen={(url) => act({ action: 'new', url })}
      />
      <Button
        variant="ghost"
        size="icon"
        className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
        disabled={!pageUrl || savePage.isPending}
        onClick={save}
        title={tKnowledge('savePage')}
        aria-label={tKnowledge('savePage')}
      >
        <BrainCircuit />
      </Button>
      <WorkspaceBrowserTabs
        tabs={tabs}
        onActivate={(tabId) => act({ action: 'activate', id: tabId })}
        onClose={(tabId) => act({ action: 'close', id: tabId })}
        onNew={() => act({ action: 'new' })}
      />
      {view === 'live' && (
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
      )}
      {view === 'live' && <WorkspaceBrowserStreamMenu />}
      {/* A phone keeps reload, the address, the tabs, "follow the agent" and the stream menu;
          back, forward and the Live/Desktop switch need a wider panel. */}
      <div className="contents max-sm:hidden">
        <WorkspaceBrowserViewSwitch view={view} onChange={onViewChange} />
      </div>
    </div>
  );
}
