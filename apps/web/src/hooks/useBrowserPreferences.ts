import { useCallback, useSyncExternalStore } from 'react';
import type { VideoPreference } from '@/hooks/useBrowserScreencast';

const VIEW_STORAGE_KEY = 'workspace:browser:view';
const LOSSLESS_STORAGE_KEY = 'workspace:browser:lossless';
const FOLLOW_AGENT_STORAGE_KEY = 'workspace:browser:followAgent';
const VIDEO_PREFERENCE_STORAGE_KEY = 'workspace:browser:stream';
const HOLD_SIZE_STORAGE_KEY = 'workspace:browser:holdSize';

// The live view streams the tab in front; the desktop view shows the whole display over VNC.
export type BrowserView = 'live' | 'desktop';

interface BrowserPreferences {
  // Whether the stored choices were read, so the tool does not connect with the defaults first.
  ready: boolean;
  view: BrowserView;
  lossless: boolean;
  // The live view streams the tab the agent works in; turned off, it stays on the tab in
  // front, whichever it or the person last switched to.
  followAgent: boolean;
  // The live view's stream: video or single frames chosen by the connection (auto), or one of
  // them always.
  videoPreference: VideoPreference;
  // "Größe festhalten": the page keeps its size when this device's panel changes size, and the
  // view only scales it.
  holdSize: boolean;
}

const DEFAULTS: BrowserPreferences = {
  ready: false,
  view: 'live',
  lossless: false,
  followAgent: true,
  videoPreference: 'auto',
  holdSize: false,
};

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // The current view keeps the choice without persistent storage.
  }
}

function read(): BrowserPreferences {
  try {
    const stream = localStorage.getItem(VIDEO_PREFERENCE_STORAGE_KEY);
    return {
      ready: true,
      view: localStorage.getItem(VIEW_STORAGE_KEY) === 'desktop' ? 'desktop' : 'live',
      lossless: localStorage.getItem(LOSSLESS_STORAGE_KEY) === 'true',
      followAgent: localStorage.getItem(FOLLOW_AGENT_STORAGE_KEY) !== 'false',
      videoPreference: stream === 'video' || stream === 'jpeg' ? stream : 'auto',
      holdSize: localStorage.getItem(HOLD_SIZE_STORAGE_KEY) === 'true',
    };
  } catch {
    // Without storage the defaults apply.
    return { ...DEFAULTS, ready: true };
  }
}

// One set of choices per page, shared by every part of the browser tool that reads or sets
// them (its bar, its view), so none of them has to be handed through the panel.
let current: BrowserPreferences | null = null;
const listeners = new Set<() => void>();

function snapshot(): BrowserPreferences {
  current ??= read();
  return current;
}

function update(next: Partial<BrowserPreferences>) {
  current = { ...snapshot(), ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// How the browser tool shows the project browser, as the person last chose it on this device.
export function useBrowserPreferences() {
  const preferences = useSyncExternalStore(subscribe, snapshot, () => DEFAULTS);
  const setView = useCallback((view: BrowserView) => {
    update({ view });
    store(VIEW_STORAGE_KEY, view);
  }, []);
  const toggleLossless = useCallback(() => {
    const lossless = !snapshot().lossless;
    update({ lossless });
    store(LOSSLESS_STORAGE_KEY, String(lossless));
  }, []);
  const toggleFollowAgent = useCallback(() => {
    const followAgent = !snapshot().followAgent;
    update({ followAgent });
    store(FOLLOW_AGENT_STORAGE_KEY, String(followAgent));
  }, []);
  const setVideoPreference = useCallback((videoPreference: VideoPreference) => {
    update({ videoPreference });
    store(VIDEO_PREFERENCE_STORAGE_KEY, videoPreference);
  }, []);
  const toggleHoldSize = useCallback(() => {
    const holdSize = !snapshot().holdSize;
    update({ holdSize });
    store(HOLD_SIZE_STORAGE_KEY, String(holdSize));
  }, []);
  return {
    ...preferences,
    setView,
    toggleLossless,
    toggleFollowAgent,
    setVideoPreference,
    toggleHoldSize,
  };
}
