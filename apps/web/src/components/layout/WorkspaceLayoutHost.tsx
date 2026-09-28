'use client';

import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Direction } from 'radix-ui';
import type { WorkspaceLayoutState } from '@/hooks/useWorkspaceLayout';
import { usePersistedWidth } from '@/hooks/usePersistedWidth';
import { usePersistedWidths } from '@/hooks/usePersistedWidths';
import { layoutGeometry } from '@/utils/workspaceLayout';
import { dockWidthsKey } from '@/utils/workspaceLayoutStorage';
import { cn } from '@/lib/utils';
import ResizeGrip from '@/components/common/ResizeGrip';
import { SidePanelResizeHandle, useSidePanelWidth } from '@/components/helena/ResizableSidePanel';
import WorkspacePanel, { type PanelArea } from './WorkspacePanel';

// Two tools side by side need about twice the room of one.
const SPLIT_DEFAULT_WIDTH = 1180;
const SPLIT_MIN_WIDTH = 720;
const SPLIT_MAX_WIDTH = 2400;
// A chat docked beside the page.
const DOCK_DEFAULT_WIDTH = 440;
const DOCK_MIN_WIDTH = 320;
const DOCK_MAX_WIDTH = 900;
// The page keeps this much room beside the panel on one screen.
const PAGE_MIN_WIDTH = 400;

// The room under the app header, laid out by the workspace layout
// (hooks/useWorkspaceLayout): one grid with a column per area — the page, a docked chat,
// the panel's tools — whose items never move in the DOM, only between columns. The page
// keeps its place when it is hidden, and the panel's frames and views keep theirs
// (WorkspacePanel), so switching layouts or moving a tool reloads nothing. The grips
// between the columns resize a docked area or the panel, and each width is remembered.
export default function WorkspaceLayoutHost({
  layout,
  projectKey,
  children,
}: {
  layout: WorkspaceLayoutState;
  projectKey: string | null;
  // The page.
  children: ReactNode;
}) {
  const t = useTranslations('nav.layout');
  const tChat = useTranslations('aiChat');
  const direction = Direction.useDirection();
  const [leftDrop, setLeftDrop] = useState(false);
  const { resolved, panel, phone, dual, context } = layout;
  const panelAreas = resolved.areas.filter((area) => area.side === 'panel');
  const split = panelAreas.length > 1;
  // One tool on the right has the shared side-panel width (the same as the previews);
  // two tools side by side remember a width of their own.
  const sideWidth = useSidePanelWidth();
  const splitWidth = usePersistedWidth(
    'workspace:panel:width:split',
    SPLIT_DEFAULT_WIDTH,
    SPLIT_MIN_WIDTH,
    SPLIT_MAX_WIDTH,
  );
  const panelWidth = split ? splitWidth : sideWidth;
  const docks = usePersistedWidths(
    dockWidthsKey(context, resolved.id),
    DOCK_DEFAULT_WIDTH,
    DOCK_MIN_WIDTH,
    DOCK_MAX_WIDTH,
  );
  const overlay = resolved.closable && (phone || panel.mode === 'overlay');
  const geometry = layoutGeometry({
    resolved,
    overlay,
    phone,
    dual,
    panelWidth: panelWidth.width,
    dockWidth: docks.widthOf,
    pageMin: PAGE_MIN_WIDTH,
  });
  // The same list while nothing moves, so the panel does not describe its tools anew.
  const areasJson = JSON.stringify(
    resolved.areas.flatMap((area) =>
      area.kind === 'tool' && area.tool
        ? [{ id: area.id, tool: area.tool, main: area.main, column: geometry.column[area.id] }]
        : [],
    ),
  );
  const toolAreas = useMemo(() => JSON.parse(areasJson) as PanelArea[], [areasJson]);
  // A grip on an area's start edge grows it as the pointer moves towards the start.
  const growth = (deltaX: number) => (direction === 'rtl' ? deltaX : -deltaX);
  const firstPanelArea = panelAreas[0];
  const panelGrip =
    !phone && !dual && !resolved.full && !geometry.panelFills && firstPanelArea
      ? geometry.column[firstPanelArea.id]
      : undefined;
  // The standard layout's panel floats at the right edge (globals.css), so its handle
  // floats with it on the panel's left edge instead of sitting in a grid column.
  const floating = resolved.id === 'standard' && !split;
  const dockGrips = phone
    ? []
    : resolved.areas.filter((area) => area.side === 'page' && area.kind === 'tool' && !area.fill);

  return (
    <div
      data-workspace-layout={resolved.id}
      className={cn(
        'relative grid min-h-0 flex-1 grid-rows-[6.125rem_minmax(0,1fr)] overflow-hidden',
        resolved.full && 'fixed inset-0 z-50 bg-background',
      )}
      style={{
        gridTemplateColumns:
          resolved.id === 'page-tool-half' && !phone && !dual
            ? 'minmax(0,1fr) minmax(0,1fr)'
            : geometry.columns,
      }}
    >
      <div
        className={cn(
          'relative row-span-full flex min-h-0 min-w-0 flex-col overflow-hidden',
          !resolved.pageVisible && 'hidden',
          leftDrop && 'ring-2 ring-[#ae8bcf] ring-inset',
        )}
        onDragOver={(event) => {
          const valid =
            event.dataTransfer.types.includes('application/x-helena-tab') &&
            event.clientX < event.currentTarget.getBoundingClientRect().left + 100;
          if (valid) event.preventDefault();
          setLeftDrop(valid);
        }}
        onDragLeave={() => setLeftDrop(false)}
        onDrop={(event) => {
          event.preventDefault();
          setLeftDrop(false);
          const key = event.dataTransfer.getData('application/x-helena-tab');
          if (key) layout.moveTabLeft(key);
        }}
        style={{
          gridColumn: geometry.pageColumn,
          // How much of the page a floating panel covers, for a page that would rather
          // make room than be covered (Start: pe-(--workspace-overlay-inset)).
          ...(overlay && !phone && panelAreas.length > 0
            ? ({
                '--workspace-overlay-inset': `${Math.round(panelWidth.width)}px`,
              } as CSSProperties)
            : {}),
        }}
      >
        {children}
      </div>

      <WorkspacePanel
        areas={toolAreas}
        contextProjectKey={projectKey}
        toolSession={panel.toolSession}
        mode={panel.mode}
        overlay={overlay}
        full={resolved.full}
        closable={resolved.closable}
        onToggleMode={panel.toggleMode}
        onToggleFull={layout.toggleFull}
        onPickTool={layout.pickTool}
        onCloseArea={layout.closeArea}
        onClose={() => {
          if (resolved.full) layout.choosePanelLayout('side');
          panel.setOpen(false);
        }}
        tabs={layout.tabs}
        activeTool={panel.activeTool}
        layoutId={layout.chosenId}
        onSelectTab={layout.activateTab}
        onCloseTab={layout.closeTab}
        onChooseLayout={layout.choosePanelLayout}
      />

      {dockGrips.map((area) => (
        <ResizeGrip
          key={`grip:${area.id}`}
          label={t('resizeArea')}
          className="helena-resize-handle row-span-full justify-self-start"
          style={{ gridColumn: String(geometry.column[area.id]) }}
          onDrag={(deltaX) => docks.setWidth(area.id, docks.widthOf(area.id) + growth(deltaX))}
        />
      ))}
      {panelGrip !== undefined &&
        (floating ? (
          <SidePanelResizeHandle className="helena-panel-handle" />
        ) : split ? (
          <ResizeGrip
            label={tChat('resizePanel')}
            className={cn(
              'helena-resize-handle row-span-full justify-self-start',
              overlay && 'z-30',
            )}
            style={{ gridColumn: String(panelGrip) }}
            onDrag={(deltaX) => panelWidth.setWidth(panelWidth.width + growth(deltaX))}
          />
        ) : (
          <SidePanelResizeHandle
            className={cn('row-span-full justify-self-start', overlay && 'z-30')}
            style={{ gridColumn: String(panelGrip) }}
          />
        ))}
    </div>
  );
}
