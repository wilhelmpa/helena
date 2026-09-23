'use client';

import { useEffect, useMemo, useState } from 'react';
import { useWorkspaceContents } from '@/context/workspaceContents';
import { useTranslations } from 'next-intl';
import { Direction } from 'radix-ui';
import { useIsMobile } from '@/hooks/use-mobile';
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
const BROWSER_LOSSLESS_STORAGE_KEY = 'workspace:browser:lossless';

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
      files: t('files'),
      inbox: t('inbox'),
      mail: t('mail'),
      connections: t('connections'),
    }),
    [t],
  );
  const [advanced, setAdvanced] = useState(false);
  const [browserLossless, setBrowserLossless] = useState(false);
  const [browserPreferenceReady, setBrowserPreferenceReady] = useState(false);
  const [frames, setFrames] = useState<
    { key: string; url: string; title: string; tool: WorkspaceToolId }[]
  >([]);
  const [frameReloads, setFrameReloads] = useState<Record<string, number>>({});
  const [visitedContents, setVisitedContents] = useState<WorkspaceToolId[]>([]);

  // What a visible tool shows: its own view where one is registered, else a frame. The
  // advanced chat view is a frame, and only the active tool offers it.
  const visible = useMemo(() => {
    const describe = (id: WorkspaceToolId, side: Side) => {
      const withAdvanced = side === 'primary' && id === 'chat' && advanced;
      const content = withAdvanced ? undefined : contents[id];
      const entry = tools[id];
      let url: string | null = withAdvanced ? entry.advancedUrl : entry.url;
      if (id === 'browser' && url) {
        url = browserPreferenceReady ? browserStreamUrl(url, browserLossless) : null;
      }
      const key = `${id}:${id === 'browser' ? `${entry.url}:${toolSession}` : url}`;
      return { id, side, content, url: content ? null : url, key, label: labels[id] };
    };
    return [
      describe(activeTool, 'primary'),
      ...(secondaryTool ? [describe(secondaryTool, 'secondary')] : []),
    ];
  }, [
    activeTool,
    advanced,
    browserLossless,
    browserPreferenceReady,
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
    try {
      setBrowserLossless(localStorage.getItem(BROWSER_LOSSLESS_STORAGE_KEY) === 'true');
    } catch {
      setBrowserLossless(false);
    } finally {
      setBrowserPreferenceReady(true);
    }
  }, []);
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
          { key: entry.key, url: entry.url, title: entry.label, tool: entry.id },
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

  const browserBase = tools.browser.url ? browserControlBase(tools.browser.url) : null;
  const browserBar = browserBase ? <WorkspaceBrowserBar base={browserBase} /> : undefined;
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
      style={fullscreen ? undefined : { width: isMobile ? '100%' : width }}
    >
      {!isMobile && !fullscreen && (
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
          browserPreferenceReady
        }
        browserLossless={browserLossless}
        externalUrl={primary.content ? null : primary.url}
        isMobile={isMobile}
        fullscreen={fullscreen}
        mode={mode}
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
        onToggleBrowserLossless={() =>
          setBrowserLossless((current) => {
            const next = !current;
            try {
              localStorage.setItem(BROWSER_LOSSLESS_STORAGE_KEY, String(next));
            } catch {
              // The current view can still use the selected mode without persistent storage.
            }
            return next;
          })
        }
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
          return (
            <WorkspaceFrame
              key={frame.key}
              url={frame.url}
              title={frame.title}
              tool={frame.tool}
              active={open && side !== undefined}
              className={cn(split && 'h-full w-full', placement(side))}
              reloadToken={frameReloads[frame.key] ?? 0}
            />
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
                !entry.content && !entry.url && (entry.id !== 'browser' || browserPreferenceReady),
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
