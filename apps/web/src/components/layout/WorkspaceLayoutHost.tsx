'use client';

import { useMemo, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Direction } from 'radix-ui';
import type { WorkspaceLayoutState } from '@/hooks/useWorkspaceLayout';
import { usePersistedWidth } from '@/hooks/usePersistedWidth';
import { usePersistedWidths } from '@/hooks/usePersistedWidths';
import { layoutGeometry } from '@/utils/workspaceLayout';
import { dockWidthsKey } from '@/utils/workspaceLayoutStorage';
import { cn } from '@/lib/utils';
import ResizeGrip from '@/components/common/ResizeGrip';
import WorkspacePanel, { type PanelArea } from './WorkspacePanel';

const PANEL_DEFAULT_WIDTH = 620;
const PANEL_MIN_WIDTH = 360;
const PANEL_MAX_WIDTH = 1200;
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
  const { resolved, panel, phone, dual, context } = layout;
  const panelAreas = resolved.areas.filter((area) => area.side === 'panel');
  const split = panelAreas.length > 1;
  const panelWidth = usePersistedWidth(
    split ? 'workspace:panel:width:split' : 'workspace:panel:width',
    split ? SPLIT_DEFAULT_WIDTH : PANEL_DEFAULT_WIDTH,
    split ? SPLIT_MIN_WIDTH : PANEL_MIN_WIDTH,
    split ? SPLIT_MAX_WIDTH : PANEL_MAX_WIDTH,
  );
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
  const dockGrips = phone
    ? []
    : resolved.areas.filter((area) => area.side === 'page' && area.kind === 'tool' && !area.fill);

  return (
    <div
      data-workspace-layout={resolved.id}
      className={cn(
        'relative grid min-h-0 flex-1 grid-rows-[2.5rem_minmax(0,1fr)] overflow-hidden',
        resolved.full && 'fixed inset-0 z-50 bg-background',
      )}
      style={{ gridTemplateColumns: geometry.columns }}
    >
      <div
        className={cn(
          'relative row-span-full flex min-h-0 min-w-0 flex-col overflow-hidden',
          !resolved.pageVisible && 'hidden',
        )}
        style={{ gridColumn: geometry.pageColumn }}
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
        onClose={() => panel.setOpen(false)}
      />

      {dockGrips.map((area) => (
        <ResizeGrip
          key={`grip:${area.id}`}
          label={t('resizeArea')}
          className="row-span-full justify-self-start"
          style={{ gridColumn: String(geometry.column[area.id]) }}
          onDrag={(deltaX) => docks.setWidth(area.id, docks.widthOf(area.id) + growth(deltaX))}
        />
      ))}
      {panelGrip !== undefined && (
        <ResizeGrip
          label={tChat('resizePanel')}
          className={cn('row-span-full justify-self-start', overlay && 'z-30')}
          style={{ gridColumn: String(panelGrip) }}
          onDrag={(deltaX) => panelWidth.setWidth(panelWidth.width + growth(deltaX))}
        />
      )}
    </div>
  );
}
