'use client';

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import {
  FULL_LAYOUT_ID,
  STANDARD_LAYOUT_ID,
  standardLayout,
  useWorkspaceLayouts,
  type WorkspaceLayout,
} from '@/extensions/workspaceLayouts';
import { usePluginWorkspaceLayouts } from '@/extensions/pluginWorkspaceLayouts';
import { usePanelTools } from '@/extensions/panelTools';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { readLocal, useLocalValue, writeLocal } from '@/hooks/useLocalValue';
import { useWorkspacePanel } from '@/hooks/useWorkspacePanel';
import type { KioskDisplay } from '@/utils/kioskDisplay';
import {
  nextLayoutId,
  pickAreaTool,
  resolveWorkspaceLayout,
  type ResolvedLayout,
} from '@/utils/workspaceLayout';
import {
  areaToolKey,
  defaultLayout,
  layoutContext,
  layoutStorageKey,
  migrateLegacyLayout,
  parseStoredLayout,
  type LayoutContext,
  type StoredLayout,
} from '@/utils/workspaceLayoutStorage';

// The window's width, rounded down to the largest of `thresholds` it reaches (0 below
// all): a layout only cares whether it has room for an area, so a resize re-renders the
// shell only when it crosses one of them.
function useRoom(thresholds: number[]): number {
  const key = thresholds.join(',');
  const subscribe = useCallback((onChange: () => void) => {
    window.addEventListener('resize', onChange);
    return () => window.removeEventListener('resize', onChange);
  }, []);
  const snapshot = useCallback(() => {
    const width = window.innerWidth;
    return key
      .split(',')
      .map(Number)
      .filter((value) => value > 0 && width >= value)
      .reduce((max, value) => Math.max(max, value), 0);
  }, [key]);
  return useSyncExternalStore(subscribe, snapshot, () => 0);
}

// The workspace layout of this device: which layout is chosen (kept per device, and
// separately for the dual kiosk, the single kiosk and a browser), what its areas show,
// and the tool panel state it drives. A phone always shows the standard layout, one
// thing at a time. Shell reads everything from here and hands it to the layout host.
export function useWorkspaceLayout({
  kiosk,
  projectKey,
  defaultOpen,
  routedTool,
}: {
  kiosk: KioskDisplay | null;
  projectKey: string | null;
  defaultOpen: boolean;
  // The tool the page itself is (a chat page), so no area shows it a second time.
  routedTool: string | null;
}) {
  usePluginWorkspaceLayouts();
  const layouts = useWorkspaceLayouts();
  const tools = usePanelTools();
  // Read with the stored layout in the same render, so a phone never shows another
  // layout for a moment after loading.
  const phone = useMediaQuery('(max-width: 767px)');
  const dual = kiosk === 'dual';
  const context: LayoutContext = layoutContext(kiosk);
  const storageKey = layoutStorageKey(context);
  const initial = useMemo(() => defaultLayout(context), [context]);
  // Kept per device; the server render and hydration read the layout's default.
  const [raw] = useLocalValue(storageKey);
  const stored = useMemo(() => parseStoredLayout(raw) ?? initial, [initial, raw]);

  // The panel's split view and fullscreen from before layouts become a layout, once.
  useEffect(() => {
    if (readLocal(storageKey) !== null) return;
    try {
      const migrated = migrateLegacyLayout(localStorage, context);
      if (migrated) writeLocal(storageKey, JSON.stringify(migrated));
    } catch {
      // Storage off: nothing to carry over.
    }
  }, [context, storageKey]);

  // Reads the current value at call time, so two changes in one event both apply.
  const update = useCallback(
    (change: (current: StoredLayout) => StoredLayout) =>
      writeLocal(
        storageKey,
        JSON.stringify(change(parseStoredLayout(readLocal(storageKey)) ?? initial)),
      ),
    [initial, storageKey],
  );

  // A plugin's layout whose plugin is not loaded (yet) shows the standard one meanwhile.
  const chosen: WorkspaceLayout =
    layouts.find((layout) => layout.id === stored.layout) ?? standardLayout();
  const layout = phone ? standardLayout() : chosen;

  const panel = useWorkspacePanel({
    defaultOpen,
    projectKey,
    // Outside the standard layout the panel stays, like on the dual kiosk's second screen.
    pinned: dual || !layout.optionalPanel,
  });

  const areaTools = useMemo(() => {
    const picked: Record<string, string> = {};
    for (const area of layout.areas) {
      const tool = stored.tools[areaToolKey(layout.id, area.id)];
      if (tool) picked[area.id] = tool;
    }
    return picked;
  }, [layout, stored.tools]);

  const thresholds = useMemo(
    () => layout.areas.flatMap((area) => (area.minRoom ? [area.minRoom] : [])),
    [layout],
  );
  const room = useRoom(thresholds);
  const toolIds = useMemo(() => tools.map((tool) => tool.id), [tools]);

  const resolved: ResolvedLayout = useMemo(
    () =>
      resolveWorkspaceLayout({
        layout,
        activeTool: panel.activeTool,
        areaTools,
        open: panel.open,
        pinned: dual,
        room,
        routedTool,
        tools: toolIds,
      }),
    [areaTools, dual, layout, panel.activeTool, panel.open, room, routedTool, toolIds],
  );

  const { openTool, toggleTool, setOpen } = panel;

  // Choosing a layout shows it whole: in the standard one, the panel opens beside the page.
  const setLayout = useCallback(
    (id: string) => {
      setOpen(true);
      update((current) =>
        id === FULL_LAYOUT_ID
          ? {
              ...current,
              layout: id,
              previous: current.layout === FULL_LAYOUT_ID ? current.previous : current.layout,
            }
          : { layout: id, tools: current.tools },
      );
    },
    [setOpen, update],
  );

  // "Werkzeug groß" and back to the layout before it.
  const toggleFull = useCallback(
    () =>
      update((current) =>
        current.layout === FULL_LAYOUT_ID
          ? { layout: current.previous ?? STANDARD_LAYOUT_ID, tools: current.tools }
          : { ...current, layout: FULL_LAYOUT_ID, previous: current.layout },
      ),
    [update],
  );

  const cycle = useCallback(() => {
    setOpen(true);
    update((current) => {
      const id = nextLayoutId(
        layouts.map((entry) => entry.id),
        current.layout,
      );
      return id === FULL_LAYOUT_ID
        ? { ...current, layout: id, previous: current.layout }
        : { layout: id, tools: current.tools };
    });
  }, [layouts, setOpen, update]);

  // Picks a tool for one area; a tool shown in another area swaps places with it.
  const pickTool = useCallback(
    (areaId: string, tool: string) => {
      const changes = pickAreaTool(resolved, areaId, tool);
      if (Object.keys(changes.areaTools).length > 0) {
        update((current) => {
          const next = { ...current.tools };
          for (const [area, value] of Object.entries(changes.areaTools)) {
            next[areaToolKey(layout.id, area)] = value;
          }
          return { ...current, tools: next };
        });
      }
      if (changes.activeTool) openTool(changes.activeTool);
    },
    [layout.id, openTool, resolved, update],
  );

  // An area with a tool of its own that already shows `tool` (the docked chat).
  const shownBeside = useCallback(
    (tool: string) => resolved.areas.some((area) => !area.main && area.tool === tool),
    [resolved],
  );

  // The header's tool buttons and the chat hotkey: a tool another area already shows
  // stays where it is instead of opening a second time in the panel.
  // A panel that cannot close keeps the tool it shows (a second click would reload it).
  const selectTool = useCallback(
    (tool: string) => {
      if (shownBeside(tool)) return;
      if (!resolved.closable && resolved.mainTool === tool) return;
      toggleTool(tool);
    },
    [resolved.closable, resolved.mainTool, shownBeside, toggleTool],
  );
  const showTool = useCallback(
    (tool: string) => {
      if (!shownBeside(tool)) openTool(tool);
    },
    [openTool, shownBeside],
  );

  // Back to the page alone: from an area's close button, the standard layout.
  const closeArea = useCallback(() => setLayout(STANDARD_LAYOUT_ID), [setLayout]);

  return {
    context,
    dual,
    phone,
    layouts,
    // The chosen layout, also while a phone shows the standard one.
    chosenId: chosen.id,
    layout,
    resolved,
    panel,
    setLayout,
    toggleFull,
    cycle,
    pickTool,
    selectTool,
    showTool,
    closeArea,
  };
}

export type WorkspaceLayoutState = ReturnType<typeof useWorkspaceLayout>;
