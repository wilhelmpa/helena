import { useCallback, useEffect, useState } from 'react';

const VIEW_STORAGE_KEY = 'workspace:browser:view';
const LOSSLESS_STORAGE_KEY = 'workspace:browser:lossless';
const FOLLOW_AGENT_STORAGE_KEY = 'workspace:browser:followAgent';

// The live view streams the tab in front; the desktop view shows the whole display over VNC.
export type BrowserView = 'live' | 'desktop';

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // The current view keeps the choice without persistent storage.
  }
}

// How the browser tool shows the project browser, as the person last chose it. ready turns
// true once the stored choice is read, so the tool does not connect with the defaults first.
export function useBrowserPreferences() {
  const [ready, setReady] = useState(false);
  const [view, setViewState] = useState<BrowserView>('live');
  const [lossless, setLosslessState] = useState(false);
  // The live view streams the tab the agent works in; turned off, it stays on the tab in
  // front, whichever it or the person last switched to.
  const [followAgent, setFollowAgentState] = useState(true);
  useEffect(() => {
    try {
      setViewState(localStorage.getItem(VIEW_STORAGE_KEY) === 'desktop' ? 'desktop' : 'live');
      setLosslessState(localStorage.getItem(LOSSLESS_STORAGE_KEY) === 'true');
      setFollowAgentState(localStorage.getItem(FOLLOW_AGENT_STORAGE_KEY) !== 'false');
    } catch {
      // Without storage the defaults apply.
    } finally {
      setReady(true);
    }
  }, []);
  const setView = useCallback((next: BrowserView) => {
    setViewState(next);
    store(VIEW_STORAGE_KEY, next);
  }, []);
  const toggleLossless = useCallback(() => {
    setLosslessState((current) => {
      store(LOSSLESS_STORAGE_KEY, String(!current));
      return !current;
    });
  }, []);
  const toggleFollowAgent = useCallback(() => {
    setFollowAgentState((current) => {
      store(FOLLOW_AGENT_STORAGE_KEY, String(!current));
      return !current;
    });
  }, []);
  return { ready, view, setView, lossless, toggleLossless, followAgent, toggleFollowAgent };
}
