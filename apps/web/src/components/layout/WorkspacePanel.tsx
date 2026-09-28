'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PanelHeaderSlotCtx } from '@/context/panelHeaderSlot';
import { useTranslations } from 'next-intl';
import { useIsMobile } from '@/hooks/use-mobile';
import { useBrowserPreferences } from '@/hooks/useBrowserPreferences';
import type { WorkspacePanelMode } from '@/hooks/useWorkspacePanel';
import { browserControlBase } from '@/utils/browserControl';
import { runtimeEnv } from '@/utils/runtimeEnv';
import { useProjectProvisioningQuery } from '@/services/projects.service';
import type { WorkspaceTool, WorkspaceToolId } from '@/utils/workspaceTools';
import { workspaceTools } from '@/utils/workspaceTools';
import { panelTool, useOfferedPanelTools, usePanelTools } from '@/extensions/panelTools';
import { usePanelToolLabel } from '@/extensions/pluginPanelTools';
import { cn } from '@/lib/utils';
import WorkspaceAreaHeader from './WorkspaceAreaHeader';
import WorkspaceBrowserBar from './WorkspaceBrowserBar';
import WorkspaceBrowserLive from './WorkspaceBrowserLive';
import WorkspaceFrame from './WorkspaceFrame';
import WorkspacePanelHeader from './WorkspacePanelHeader';
import WorkspaceTabBar from './WorkspaceTabBar';
import type { useWorkspaceTabs } from '@/hooks/useWorkspaceTabs';
import WorkspaceToolPicker from './WorkspaceToolPicker';
import WorkspaceUnavailable from './WorkspaceUnavailable';

function browserStreamUrl(url: string, lossless: boolean) {
  const parsed = new URL(url);
  // The desktop is a 4K screen with Chromium at scale 2; the client scales it into the
  // panel, so it is as large and as sharp as the live view (owner, 2026-09-24).
  parsed.searchParams.set('resize', 'scale');
  if (lossless) parsed.searchParams.set('stream', 'lossless');
  else parsed.searchParams.delete('stream');
  return parsed.toString();
}

// A tool area of the workspace layout (utils/workspaceLayout.ts) and its grid column in
// the layout host.
export interface PanelArea {
  id: string;
  tool: WorkspaceToolId;
  // The panel's own tool, the one the header's tool buttons pick.
  main: boolean;
  column: number;
}

// The panel tools of the workspace layout: each area's header and the tools' views, as
// items of the layout host's grid (WorkspaceLayoutHost), row 1 the headers, row 2 the
// views. The frames and tool views stay mounted in one flat list and only change their
// grid column, so moving a tool between areas or layouts never reloads it (an iframe
// reloads when it moves in the DOM: a terminal session, code-server, a plugin's page).
export default function WorkspacePanel({
  areas,
  contextProjectKey,
  toolSession,
  mode,
  overlay,
  full,
  closable,
  onToggleMode,
  onToggleFull,
  onPickTool,
  onCloseArea,
  onClose,
  dockSheet = false,
  tabs,
  activeTool,
  layoutId,
  onSelectTab,
  onCloseTab,
  onChooseLayout,
}: {
  areas: PanelArea[];
  contextProjectKey: string | null;
  toolSession: number;
  mode: WorkspacePanelMode;
  // The panel floats over the page (the standard layout's overlay mode, a phone).
  overlay: boolean;
  // The main tool takes the whole window ("Werkzeug groß").
  full: boolean;
  // The panel may close and float: the standard layout, not on the dual kiosk.
  closable: boolean;
  onToggleMode: () => void;
  onToggleFull: () => void;
  onPickTool: (areaId: string, tool: WorkspaceToolId) => void;
  onCloseArea: (areaId: string) => void;
  onClose: () => void;
  dockSheet?: boolean;
  tabs: ReturnType<typeof useWorkspaceTabs>;
  activeTool: string;
  layoutId: string;
  onSelectTab: (tool: string) => void;
  onCloseTab: (key: string) => void;
  onChooseLayout: (choice: 'side' | 'split' | 'full') => void;
}) {
  const t = useTranslations('nav.workspace');
  const isMobile = useIsMobile();
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
  // Every panel tool (extensions/panelTools.tsx): the built-ins and plugins' tools.
  const registered = usePanelTools();
  // What the area's tool picker offers: without a tool this origin does not have.
  const offered = useOfferedPanelTools();
  const labelOf = usePanelToolLabel();
  const labels = useMemo<Record<WorkspaceToolId, string>>(
    () => Object.fromEntries(registered.map((entry) => [entry.id, labelOf(entry)])),
    [labelOf, registered],
  );
  // Where a tool's frame is: the deployment's address for a built-in, the plugin's page
  // for a plugin's tool, none for a view of the app itself.
  const entryOf = useCallback(
    (id: WorkspaceToolId): WorkspaceTool => {
      const view = registered.find((entry) => entry.id === id)?.view;
      if (view?.kind === 'frame') return { id: 'connections', url: view.url, advancedUrl: '' };
      return (
        (tools as Record<string, WorkspaceTool | undefined>)[id] ?? {
          id: 'connections',
          url: '',
          advancedUrl: '',
        }
      );
    },
    [registered, tools],
  );
  const mainArea = areas.find((area) => area.main) ?? null;
  const mainTool = mainArea?.tool ?? null;
  const [advanced, setAdvanced] = useState(false);
  const browserPreferences = useBrowserPreferences();
  const browserBase = tools.browser.url ? browserControlBase(tools.browser.url) : null;
  // The live view needs the browser router's control routes next to the VNC stream.
  const browserLive = browserPreferences.view === 'live' && browserBase !== null;
  const [frames, setFrames] = useState<
    {
      key: string;
      url: string;
      title: string;
      tool: WorkspaceToolId;
      live: boolean;
      // A plugin's page, which runs sandboxed.
      sandboxed: boolean;
    }[]
  >([]);
  const [frameReloads, setFrameReloads] = useState<Record<string, number>>({});
  const [visitedContents, setVisitedContents] = useState<WorkspaceToolId[]>([]);

  // What a visible tool shows: its own view where one is registered, else a frame. The
  // advanced chat view is a frame, and only the main area offers it. The browser's frame
  // is its live view or the VNC desktop.
  const visible = useMemo(() => {
    const describe = (area: PanelArea) => {
      const id = area.tool;
      const withAdvanced = area.main && id === 'chat' && advanced;
      const view = registered.find((entry) => entry.id === id)?.view;
      const content = withAdvanced || view?.kind !== 'component' ? undefined : view.component;
      const entry = entryOf(id);
      const sandboxed = view?.kind === 'frame';
      const live = id === 'browser' && browserLive;
      let url: string | null = withAdvanced ? entry.advancedUrl : entry.url;
      if (id === 'browser' && url) {
        if (!browserPreferences.ready) url = null;
        else if (!live) url = browserStreamUrl(url, browserPreferences.lossless);
      }
      const key = `${id}:${id === 'browser' ? `${entry.url}:${toolSession}:${live}` : url}`;
      return {
        id,
        area,
        content,
        url: content ? null : url,
        key,
        label: labels[id] ?? id,
        live,
        sandboxed,
      };
    };
    return areas.map(describe);
  }, [
    advanced,
    areas,
    browserLive,
    browserPreferences.lossless,
    browserPreferences.ready,
    entryOf,
    labels,
    registered,
    toolSession,
  ]);
  const areaOfFrame = new Map(visible.map((entry) => [entry.key, entry.area]));
  const areaOfContent = new Map(
    visible.filter((entry) => entry.content).map((entry) => [entry.id, entry.area]),
  );

  useEffect(() => setAdvanced(false), [mainTool, contextProjectKey]);
  useEffect(() => {
    if (visible.length === 0) return;
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
          {
            key: entry.key,
            url: entry.url,
            title: entry.label,
            tool: entry.id,
            live: entry.live,
            sandboxed: entry.sandboxed,
          },
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
  }, [visible]);

  const browserBar = browserBase ? (
    <WorkspaceBrowserBar
      base={browserBase}
      projectKey={contextProjectKey}
      view={browserPreferences.view}
      onViewChange={browserPreferences.setView}
      followAgent={browserPreferences.followAgent}
      onToggleFollowAgent={browserPreferences.toggleFollowAgent}
    />
  ) : undefined;

  // Where the tool an area shows may put its own bar (see PanelHeaderSlotCtx), by area.
  // The ref callbacks are kept per area, so React does not hand a new one every render.
  const [slots, setSlots] = useState<Record<string, HTMLElement | null>>({});
  const [slotRef] = useState(() => {
    const refs = new Map<string, (element: HTMLElement | null) => void>();
    return (areaId: string) => {
      let ref = refs.get(areaId);
      if (!ref) {
        ref = (element) =>
          setSlots((current) =>
            current[areaId] === element ? current : { ...current, [areaId]: element },
          );
        refs.set(areaId, ref);
      }
      return ref;
    };
  });

  // Above the page while the panel floats over it; equal layers keep the DOM order.
  const layer = overlay ? 'z-30' : undefined;
  const place = (area: PanelArea | undefined, row: '1' | '2' | '1 / -1') =>
    area ? { gridColumn: String(area.column), gridRow: row } : undefined;
  const picker = (area: PanelArea) => (
    <WorkspaceToolPicker
      tools={offered}
      current={area.tool}
      shown={areas.map((entry) => entry.tool)}
      labels={labels}
      onPick={(tool) => onPickTool(area.id, tool)}
    />
  );

  return (
    <>
      {dockSheet && (
        <button
          type="button"
          className="helena-home-scrim"
          aria-label="Home schließen"
          onClick={onClose}
        />
      )}
      {visible.map((entry) => (
        // The area's surface under its header and view: the border to its neighbour and,
        // over the page, the panel's shadow.
        <div
          key={`surface:${entry.area.id}`}
          aria-hidden="true"
          data-panel-part={entry.area.main ? 'surface' : undefined}
          data-dock-part={dockSheet && entry.area.main ? 'surface' : undefined}
          className={cn(
            'min-w-0 bg-background',
            !full && 'border-s',
            layer,
            overlay && 'shadow-[var(--side-panel-shadow)]',
          )}
          style={place(entry.area, '1 / -1')}
        />
      ))}

      {visible.map((entry) =>
        entry.area.main ? (
          <div
            key={`header:${entry.area.id}`}
            data-panel-part="header"
            data-panel-tool={entry.id}
            data-dock-part={dockSheet ? 'header' : undefined}
            className={cn('min-w-0', layer)}
            style={place(entry.area, '1')}
          >
            <WorkspaceTabBar
              tabs={tabs}
              activeTool={activeTool}
              browserBase={browserBase}
              layoutId={layoutId}
              onSelectTool={onSelectTab}
              onCloseTab={onCloseTab}
              onChooseLayout={onChooseLayout}
              onClose={onClose}
            />
            <WorkspacePanelHeader
              title={advanced ? t('advanced') : entry.label}
              advanced={advanced}
              canExpandChat={entry.id === 'chat' && !!entryOf('chat').advancedUrl}
              canToggleBrowserLossless={
                visible.some((shown) => shown.id === 'browser' && !!tools.browser.url) &&
                browserPreferences.ready &&
                !browserLive
              }
              browserLossless={browserPreferences.lossless}
              externalUrl={entry.content ? null : entry.url}
              isMobile={isMobile}
              full={full}
              mode={mode}
              closable={closable}
              picker={null}
              toolbar={entry.id === 'browser' ? browserBar : undefined}
              slotRef={slotRef(entry.area.id)}
              onToggleAdvanced={() => setAdvanced((current) => !current)}
              onToggleBrowserLossless={browserPreferences.toggleLossless}
              onToggleMode={onToggleMode}
              onToggleFull={onToggleFull}
              onReload={() =>
                setFrameReloads((current) => ({
                  ...current,
                  [entry.key]: (current[entry.key] ?? 0) + 1,
                }))
              }
              onClose={onClose}
              tabbed
            />
          </div>
        ) : (
          <div
            key={`header:${entry.area.id}`}
            className={cn('min-w-0', layer)}
            style={place(entry.area, '1')}
          >
            <WorkspaceAreaHeader
              title={entry.label}
              picker={picker(entry.area)}
              toolbar={entry.id === 'browser' ? browserBar : undefined}
              slotRef={slotRef(entry.area.id)}
              onClose={() => onCloseArea(entry.area.id)}
            />
          </div>
        ),
      )}

      {frames.map((frame) => {
        const area = areaOfFrame.get(frame.key);
        const liveBase = frame.live ? browserControlBase(frame.url) : null;
        const props = {
          active: area !== undefined,
          className: 'flex-1',
          reloadToken: frameReloads[frame.key] ?? 0,
        };
        return (
          // Kept in the list while hidden, so switching back or moving it never reloads it.
          <div
            key={frame.key}
            data-panel-part={area?.main ? 'content' : undefined}
            data-panel-tool={area?.main ? frame.tool : undefined}
            role="region"
            aria-label={frame.title}
            className={cn('flex min-h-0 min-w-0 flex-col', layer, !area && 'hidden')}
            style={place(area, '2')}
          >
            {liveBase ? (
              <WorkspaceBrowserLive
                base={liveBase}
                followAgent={browserPreferences.followAgent}
                controlSlot={area ? slots[area.id] : null}
                {...props}
              />
            ) : (
              <WorkspaceFrame
                url={frame.url}
                title={frame.title}
                sandbox={frame.sandboxed ? 'allow-scripts allow-forms' : undefined}
                {...props}
              />
            )}
          </div>
        );
      })}
      {visitedContents.map((id) => {
        const view = panelTool(id)?.view;
        const ToolContent = view?.kind === 'component' ? view.component : undefined;
        const area = areaOfContent.get(id);
        return ToolContent ? (
          <div
            key={`${id}:${contextProjectKey ?? 'global'}`}
            data-panel-part={area?.main ? 'content' : undefined}
            data-panel-tool={area?.main ? id : undefined}
            data-dock-part={dockSheet && area?.main ? 'content' : undefined}
            role="region"
            aria-label={labels[id] ?? id}
            className={cn(
              // A flex column, so a tool's own frame (a terminal, code) can grow to the
              // area's height instead of an iframe's default 150px.
              'flex min-h-0 min-w-0 flex-col overflow-hidden',
              layer,
              !area && 'hidden',
            )}
            style={place(area, '2')}
          >
            <PanelHeaderSlotCtx.Provider
              value={area && !(area.main && advanced) ? (slots[area.id] ?? null) : null}
            >
              <ToolContent projectKey={contextProjectKey} />
            </PanelHeaderSlotCtx.Provider>
          </div>
        ) : null;
      })}
      {visible
        .filter(
          (entry) =>
            !entry.content && !entry.url && (entry.id !== 'browser' || browserPreferences.ready),
        )
        .map((entry) => (
          <div
            key={`unavailable:${entry.area.id}`}
            data-panel-part={entry.area.main ? 'content' : undefined}
            className={cn('flex min-h-0 min-w-0', layer)}
            style={place(entry.area, '2')}
          >
            <WorkspaceUnavailable tool={labels[entry.id] ?? entry.id} />
          </div>
        ))}
    </>
  );
}
