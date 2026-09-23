'use client';

import { useEffect, useMemo, useState } from 'react';
import { useWorkspaceContents } from '@/context/workspaceContents';
import { useTranslations } from 'next-intl';
import { Direction } from 'radix-ui';
import { useIsMobile } from '@/hooks/use-mobile';
import { useBrowserPreferences } from '@/hooks/useBrowserPreferences';
import { usePersistedWidth } from '@/hooks/usePersistedWidth';
import type { WorkspacePanelMode } from '@/hooks/useWorkspacePanel';
import { browserControlBase } from '@/utils/browserControl';
import { runtimeEnv } from '@/utils/runtimeEnv';
import { useProjectProvisioningQuery } from '@/services/projects.service';
import type { WorkspaceToolId } from '@/utils/workspaceTools';
import { HEADER_WORKSPACE_TOOLS, workspaceTools } from '@/utils/workspaceTools';
import { cn } from '@/lib/utils';
import ResizeGrip from '@/components/common/ResizeGrip';
import WorkspaceBrowserBar from './WorkspaceBrowserBar';
import WorkspaceBrowserLive from './WorkspaceBrowserLive';
import WorkspaceFrame from './WorkspaceFrame';
import WorkspacePanelHeader from './WorkspacePanelHeader';
import WorkspaceSplitHeader from './WorkspaceSplitHeader';
import WorkspaceSplitMenu from './WorkspaceSplitMenu';
import WorkspaceUnavailable from './WorkspaceUnavailable';

const DEFAULT_WIDTH = 620;
const MIN_WIDTH = 360;
const MAX_WIDTH = 1200;
// Two tools side by side need about twice the room of one.
const SPLIT_DEFAULT_WIDTH = 1180;
const SPLIT_MIN_WIDTH = 720;
const SPLIT_MAX_WIDTH = 2400;

function browserStreamUrl(url: string, lossless: boolean) {
  const parsed = new URL(url);
  if (lossless) parsed.searchParams.set('stream', 'lossless');
  else parsed.searchParams.delete('stream');
  return parsed.toString();
}

// The side of a split panel a tool is shown in. The frames and tool views stay mounted
// in one list, so moving a tool between halves never reloads it.
type Side = 'primary' | 'secondary';

export default function WorkspacePanel({
  open,
  activeTool,
  contextProjectKey,
  toolSession,
  splitTool,
  onSplitToolChange,
  mode,
  fullscreen,
  onToggleMode,
  onToggleFullscreen,
  pinned = false,
  onClose,
}: {
  open: boolean;
  activeTool: WorkspaceToolId;
  contextProjectKey: string | null;
  toolSession: number;
  splitTool: WorkspaceToolId | null;
  onSplitToolChange: (tool: WorkspaceToolId | null) => void;
  mode: WorkspacePanelMode;
  fullscreen: boolean;
  onToggleMode: () => void;
  onToggleFullscreen: () => void;
  // Fills the second of two kiosk screens: half the window, no resizing, no closing.
  pinned?: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('nav.workspace');
  const tChat = useTranslations('aiChat');
  const direction = Direction.useDirection();
  const isMobile = useIsMobile();
  const secondaryTool = !isMobile && splitTool && splitTool !== activeTool ? splitTool : null;
  const { width, setWidth } = usePersistedWidth(
    secondaryTool ? 'workspace:panel:width:split' : 'workspace:panel:width',
    secondaryTool ? SPLIT_DEFAULT_WIDTH : DEFAULT_WIDTH,
    secondaryTool ? SPLIT_MIN_WIDTH : MIN_WIDTH,
    secondaryTool ? SPLIT_MAX_WIDTH : MAX_WIDTH,
  );
  const workspaceConfig = runtimeEnv().workspace;
  const provisioning = useProjectProvisioningQuery(contextProjectKey);
  const provisionedResources = useMemo(
    () =>
      provisioning.data?.status === 'succeeded' ? (provisioning.data.result?.resources ?? []) : [],
    [provisioning.data],
  );
  const tools = useMemo(
    () => workspaceTools(workspaceConfig, contextProjectKey, provisionedResources),
    [contextProjectKey, provisionedResources, workspaceConfig],
  );
  const tool = tools[activeTool];
  const contents = useWorkspaceContents();
  const labels = useMemo<Record<WorkspaceToolId, string>>(
    () => ({
      chat: t('chat'),
      terminal: t('terminal'),
      code: t('code'),
      browser: t('browser'),
      inbox: t('inbox'),
      mail: t('mail'),
      connections: t('connections'),
    }),
    [t],
  );
  const [advanced, setAdvanced] = useState(false);
  const browserPreferences = useBrowserPreferences();
  const browserBase = tools.browser.url ? browserControlBase(tools.browser.url) : null;
  // The live view needs the browser router's control routes next to the VNC stream.
  const browserLive = browserPreferences.view === 'live' && browserBase !== null;
  const [frames, setFrames] = useState<
    { key: string; url: string; title: string; tool: WorkspaceToolId; live: boolean }[]
  >([]);
  const [frameReloads, setFrameReloads] = useState<Record<string, number>>({});
  const [visitedContents, setVisitedContents] = useState<WorkspaceToolId[]>([]);

  // What a visible tool shows: its own view where one is registered, else a frame. The
  // advanced chat view is a frame, and only the active tool offers it. The browser's frame
  // is its live view or the VNC desktop.
  const visible = useMemo(() => {
    const describe = (id: WorkspaceToolId, side: Side) => {
      const withAdvanced = side === 'primary' && id === 'chat' && advanced;
      const content = withAdvanced ? undefined : contents[id];
      const entry = tools[id];
      const live = id === 'browser' && browserLive;
      let url: string | null = withAdvanced ? entry.advancedUrl : entry.url;
      if (id === 'browser' && url) {
        if (!browserPreferences.ready) url = null;
        else if (!live) url = browserStreamUrl(url, browserPreferences.lossless);
      }
      const key = `${id}:${id === 'browser' ? `${entry.url}:${toolSession}:${live}` : url}`;
      return { id, side, content, url: content ? null : url, key, label: labels[id], live };
    };
    return [
      describe(activeTool, 'primary'),
      ...(secondaryTool ? [describe(secondaryTool, 'secondary')] : []),
    ];
  }, [
    activeTool,
    advanced,
    browserLive,
    browserPreferences.lossless,
    browserPreferences.ready,
    contents,
    labels,
    secondaryTool,
    toolSession,
    tools,
  ]);
  const primary = visible[0]!;
  const sideOfFrame = new Map(visible.map((entry) => [entry.key, entry.side]));
  const sideOfContent = new Map(
    visible.filter((entry) => entry.content).map((entry) => [entry.id, entry.side]),
  );

  useEffect(() => setAdvanced(false), [activeTool, contextProjectKey]);
  useEffect(() => {
    if (!open) return;
    const shown = visible.filter((entry) => entry.content).map((entry) => entry.id);
    setVisitedContents((current) => {
      const added = shown.filter((id) => !current.includes(id));
      return added.length > 0 ? [...current, ...added] : current;
    });
    const framed = visible.filter(
      (entry): entry is typeof entry & { url: string } => !entry.content && !!entry.url,
    );
    if (framed.length === 0) return;
    setFrames((current) => {
      let next = current;
      for (const entry of framed) {
        const existing = next.find((frame) => frame.key === entry.key);
        if (existing?.url === entry.url && existing.title === entry.label) continue;
        // One browser session at a time: a new browser frame replaces the old one.
        next = [
          ...next.filter(
            (frame) =>
              frame.key !== entry.key && (entry.id !== 'browser' || frame.tool !== 'browser'),
          ),
          { key: entry.key, url: entry.url, title: entry.label, tool: entry.id, live: entry.live },
        ];
      }
      if (next === current) return current;
      // Keep the visible frames when trimming the ones kept warm in the background.
      const keep = new Set(framed.map((entry) => entry.key));
      const background = next.filter((frame) => !keep.has(frame.key));
      return [
        ...background.slice(-Math.max(0, 4 - keep.size)),
        ...next.filter((frame) => keep.has(frame.key)),
      ];
    });
  }, [open, visible]);

  const browserBar = browserBase ? (
    <WorkspaceBrowserBar
      base={browserBase}
      view={browserPreferences.view}
      onViewChange={browserPreferences.setView}
    />
  ) : undefined;
  const overlay = isMobile || mode === 'overlay';
  const title = advanced ? t('advanced') : labels[activeTool];
  const split = secondaryTool !== null;
  const placement = (side: Side | undefined) =>
    side === 'secondary' ? 'col-start-2 row-start-2' : split ? 'col-start-1 row-span-2' : '';

  return (
    <aside
      aria-label={title}
      className={cn(
        'flex h-full min-h-0 flex-col bg-background',
        !open && 'hidden',
        fullscreen
          ? 'fixed inset-0 z-50'
          : cn(
              'border-s',
              overlay
                ? 'absolute inset-y-0 end-0 z-30 shadow-[var(--side-panel-shadow)]'
                : 'relative shrink-0',
            ),
      )}
      style={fullscreen ? undefined : { width: isMobile ? '100%' : pinned ? '50vw' : width }}
    >
      {!isMobile && !fullscreen && !pinned && (
        <ResizeGrip
          label={tChat('resizePanel')}
          className="absolute inset-y-0 start-0 z-10"
          onDrag={(deltaX) => setWidth(width + (direction === 'rtl' ? deltaX : -deltaX))}
        />
      )}

      <WorkspacePanelHeader
        title={title}
        advanced={advanced}
        canExpandChat={activeTool === 'chat' && !!tool.advancedUrl}
        canToggleBrowserLossless={
          visible.some((entry) => entry.id === 'browser' && !!tools.browser.url) &&
          browserPreferences.ready &&
          !browserLive
        }
        browserLossless={browserPreferences.lossless}
        externalUrl={primary.content ? null : primary.url}
        isMobile={isMobile}
        fullscreen={fullscreen}
        mode={mode}
        pinned={pinned}
        toolbar={activeTool === 'browser' ? browserBar : undefined}
        splitControl={
          isMobile ? null : (
            <WorkspaceSplitMenu
              tools={HEADER_WORKSPACE_TOOLS.filter((id) => id !== activeTool)}
              splitTool={secondaryTool}
              labels={labels}
              onSplitToolChange={onSplitToolChange}
            />
          )
        }
        onToggleAdvanced={() => setAdvanced((current) => !current)}
        onToggleBrowserLossless={browserPreferences.toggleLossless}
        onToggleMode={onToggleMode}
        onToggleFullscreen={onToggleFullscreen}
        onReload={() =>
          setFrameReloads((current) => ({
            ...current,
            [primary.key]: (current[primary.key] ?? 0) + 1,
          }))
        }
        onClose={onClose}
      />

      <div
        className={cn(
          'min-h-0 flex-1',
          split ? 'grid grid-cols-2 grid-rows-[auto_minmax(0,1fr)] divide-x' : 'flex flex-col',
        )}
      >
        {secondaryTool && (
          <div className="col-start-2 row-start-1">
            <WorkspaceSplitHeader
              title={labels[secondaryTool]}
              toolbar={secondaryTool === 'browser' ? browserBar : undefined}
              onClose={() => onSplitToolChange(null)}
            />
          </div>
        )}
        {frames.map((frame) => {
          const side = sideOfFrame.get(frame.key);
          const liveBase = frame.live ? browserControlBase(frame.url) : null;
          const props = {
            active: open && side !== undefined,
            className: cn(split && 'h-full w-full', placement(side)),
            reloadToken: frameReloads[frame.key] ?? 0,
          };
          return liveBase ? (
            <WorkspaceBrowserLive key={frame.key} base={liveBase} {...props} />
          ) : (
            <WorkspaceFrame key={frame.key} url={frame.url} title={frame.title} {...props} />
          );
        })}
        {visitedContents.map((id) => {
          const ToolContent = contents[id];
          const side = sideOfContent.get(id);
          return ToolContent ? (
            <div
              key={`${id}:${contextProjectKey ?? 'global'}`}
              className={cn(
                'min-h-0 flex-1 overflow-hidden',
                placement(side),
                (!open || side === undefined) && 'hidden',
              )}
            >
              <ToolContent projectKey={contextProjectKey} />
            </div>
          ) : null;
        })}
        {open &&
          visible
            .filter(
              (entry) =>
                !entry.content &&
                !entry.url &&
                (entry.id !== 'browser' || browserPreferences.ready),
            )
            .map((entry) => (
              <div key={entry.id} className={cn('flex min-h-0 flex-1', placement(entry.side))}>
                <WorkspaceUnavailable tool={labels[entry.id]} />
              </div>
            ))}
      </div>
    </aside>
  );
}
