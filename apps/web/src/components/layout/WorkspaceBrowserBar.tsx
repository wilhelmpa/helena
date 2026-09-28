'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  BrainCircuit,
  ExternalLink,
  ImageIcon,
  MoreHorizontal,
  RotateCw,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useBrowserControl } from '@/hooks/useBrowserControl';
import { useCaptureWebPageMutation } from '@/services/everything.service';
import type { BrowserView } from '@/hooks/useBrowserPreferences';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import ProjectPreviewControl from '@/components/common/project-previews/ProjectPreviewControl';
import WorkspaceBrowserBookmarks from './WorkspaceBrowserBookmarks';
import WorkspaceBrowserControlStatus from './WorkspaceBrowserControlStatus';
import WorkspaceBrowserColorScheme, { type BrowserColorMode } from './WorkspaceBrowserColorScheme';
import WorkspaceBrowserStreamMenu from './WorkspaceBrowserStreamMenu';
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
  lossless,
  onToggleLossless,
  externalUrl,
  onReloadFrame,
  colorMode,
  colorModeLoaded,
  onColorModeChange,
}: {
  base: string;
  // The project whose Inbox a saved page goes to; Home's without one.
  projectKey: string | null;
  view: BrowserView;
  onViewChange: (view: BrowserView) => void;
  followAgent: boolean;
  onToggleFollowAgent: () => void;
  lossless: boolean;
  onToggleLossless: () => void;
  externalUrl: string | null;
  onReloadFrame: () => void;
  colorMode: BrowserColorMode;
  colorModeLoaded: boolean;
  onColorModeChange: (mode: BrowserColorMode) => void;
}) {
  const t = useTranslations('nav.workspace.browserBar');
  const tWorkspace = useTranslations('nav.workspace');
  const tPanel = useTranslations('nav.panelTabs');
  const tKnowledge = useTranslations('knowledge.capture');
  const router = useRouter();
  const { active, act } = useBrowserControl(base);
  // What the person is typing; null while the field shows the tab's own address.
  const [draft, setDraft] = useState<string | null>(null);
  const [more, setMore] = useState(false);
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

  // The bar measures its own width (a tool panel can be narrow while the window is
  // wide): back/forward and the view switch give way first, so the address keeps room.
  return (
    <div className="@container/browserbar relative flex min-w-0 flex-1 items-center gap-0.5">
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
      <form
        className="min-w-24 flex-1"
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
          className="h-8 w-full rounded-full border-0 bg-muted px-3 font-mono text-xs text-muted-foreground outline-none focus:text-foreground"
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
      {view !== 'live' && <WorkspaceBrowserControlStatus base={base} />}
      <WorkspaceBrowserColorScheme
        mode={colorMode}
        loaded={colorModeLoaded}
        onModeChange={onColorModeChange}
      />
      {/* The further tools open in a popover under the bar, wrapping to its width, so they
          never squeeze the address or run out of a narrow panel, and stay above the live
          view (the panel's content paints over its header). */}
      <Popover open={more} onOpenChange={setMore}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Weitere Browser-Werkzeuge"
            title="Weitere Browser-Werkzeuge"
          >
            <MoreHorizontal />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="helena-browser-extras flex w-auto max-w-[min(20rem,calc(100vw-2rem))] flex-wrap items-center gap-0.5 p-1"
        >
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
          {view !== 'live' && (
            <Button
              variant={lossless ? 'secondary' : 'ghost'}
              size="icon"
              className="size-7 shrink-0"
              onClick={onToggleLossless}
              title={tWorkspace('browserLossless')}
              aria-label={tWorkspace('browserLossless')}
              aria-pressed={lossless}
            >
              <ImageIcon />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            onClick={onReloadFrame}
            title={tPanel('reloadView')}
            aria-label={tPanel('reloadView')}
          >
            <RotateCw />
          </Button>
          {externalUrl && (
            <Button variant="ghost" size="icon" className="size-7 shrink-0" asChild>
              <a
                href={externalUrl}
                target="_blank"
                rel="noreferrer"
                title={tWorkspace('openExternal', { tool: tWorkspace('browser') })}
              >
                <ExternalLink />
                <span className="sr-only">
                  {tWorkspace('openExternal', { tool: tWorkspace('browser') })}
                </span>
              </a>
            </Button>
          )}
          {projectKey && (
            <ProjectPreviewControl
              projectKey={projectKey}
              onOpen={(url) => act({ action: 'new', url })}
            />
          )}
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
          back, forward and the Live/Desktop switch need a wider screen. */}
          <div className="contents max-sm:hidden">
            <WorkspaceBrowserViewSwitch view={view} onChange={onViewChange} />
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
