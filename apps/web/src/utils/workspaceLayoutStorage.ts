import type { KioskDisplay } from './kioskDisplay';

// Where the chosen workspace layout is kept: per device (localStorage), and separately
// for the dual kiosk, the single kiosk and a normal browser, since one device may be all
// three (the kiosk's Chromium and a browser window on the same machine).

export type LayoutContext = 'kiosk-dual' | 'kiosk-single' | 'browser';

export interface StoredLayout {
  layout: string;
  // The layout before the full one, for its way back.
  previous?: string;
  // Tools picked for areas, by `<layout id>.<area id>`.
  tools: Record<string, string>;
}

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;

// The split view and fullscreen of the tool panel before layouts; read once, then gone.
const LEGACY_SPLIT_KEY = 'workspace:panel:split';
const LEGACY_FULLSCREEN_KEY = 'workspace:panel:fullscreen';

export function layoutContext(kiosk: KioskDisplay | null): LayoutContext {
  return kiosk === 'dual' ? 'kiosk-dual' : kiosk === 'single' ? 'kiosk-single' : 'browser';
}

// Before a choice: the dual kiosk starts with the chat beside the page on the first screen
// and a tool on the second (owner, 2026-09-24: "im dual mode muss der chat nach links");
// everything else with the standard layout.
export function defaultLayout(context: LayoutContext): StoredLayout {
  return { layout: context === 'kiosk-dual' ? 'chat-left' : 'standard', tools: {} };
}

export function layoutStorageKey(context: LayoutContext): string {
  return `workspace:layout:${context}`;
}

export function projectLayoutStorageKey(context: LayoutContext, projectKey: string | null): string {
  return `${layoutStorageKey(context)}:${projectKey ?? 'home'}`;
}

// The widths of the areas docked beside the page in one layout, by area id.
export function dockWidthsKey(context: LayoutContext, layoutId: string): string {
  return `workspace:layout:${context}:widths:${layoutId}`;
}

export function areaToolKey(layoutId: string, areaId: string): string {
  return `${layoutId}.${areaId}`;
}

export function parseStoredLayout(raw: string | null): StoredLayout | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredLayout> | null;
    if (!value || typeof value.layout !== 'string' || !value.layout) return null;
    const tools: Record<string, string> = {};
    if (value.tools && typeof value.tools === 'object') {
      for (const [key, tool] of Object.entries(value.tools)) {
        if (typeof tool === 'string' && tool) tools[key] = tool;
      }
    }
    return {
      layout: value.layout,
      ...(typeof value.previous === 'string' && value.previous ? { previous: value.previous } : {}),
      tools,
    };
  } catch {
    return null;
  }
}

// A device that had the panel split before layouts existed starts on "Zwei Werkzeuge"
// with that tool, one in fullscreen on the full layout. The old keys are read once and
// removed; null when there is nothing to carry over.
export function migrateLegacyLayout(storage: Storage, context: LayoutContext): StoredLayout | null {
  const split = storage.getItem(LEGACY_SPLIT_KEY);
  const fullscreen = storage.getItem(LEGACY_FULLSCREEN_KEY) === 'true';
  storage.removeItem(LEGACY_SPLIT_KEY);
  storage.removeItem(LEGACY_FULLSCREEN_KEY);
  const tools = split ? { [areaToolKey('two-tools', 'second')]: split } : {};
  if (fullscreen && context !== 'kiosk-dual') {
    return { layout: 'tool-full', previous: split ? 'two-tools' : 'standard', tools };
  }
  if (split) return { layout: 'two-tools', tools };
  return null;
}
