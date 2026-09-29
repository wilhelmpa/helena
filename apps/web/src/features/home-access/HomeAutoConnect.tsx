'use client';

import { useEffect } from 'react';
import { getEdgeHome } from '@/lib/api/endpoints/security';
import { runtimeEnv } from '@/utils/runtimeEnv';
import {
  FAILED_KEY,
  FAILURE_PAUSE_MS,
  PROBE_TIMEOUT_MS,
  STAY_KEY,
  STAY_PARAM,
  homeTarget,
  isHomeAnswer,
  probeUrl,
  shouldProbe,
} from './homeAccess';

function readNumber(storage: Storage, key: string): number | null {
  try {
    const value = Number(storage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function write(storage: Storage, key: string, value: string | null): void {
  try {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, value);
  } catch {
    // Private mode or blocked storage: the check just runs again next time.
  }
}

// Chrome's permission for requests into the local network ('local-network-access', before
// that 'private-network-access'); unknown names and other browsers count as not denied.
async function localNetworkDenied(): Promise<boolean> {
  for (const name of ['local-network-access', 'private-network-access']) {
    try {
      const status = await navigator.permissions.query({ name: name as PermissionName });
      return status.state === 'denied';
    } catch {
      // Not a permission this browser knows.
    }
  }
  return false;
}

// Switches to the home network's own origin when it answers from this device (see
// ./homeAccess.ts). Runs once per page load on any other origin, in the background; renders
// nothing. Whether it runs at all is the instance setting "Zu Hause automatisch direkt
// verbinden" (Administrator → Sicherheit → Zugang von außen).
export default function HomeAutoConnect() {
  useEffect(() => {
    const homeUrl = runtimeEnv().homeUrl;
    const params = new URLSearchParams(window.location.search);
    if (params.has(STAY_PARAM)) write(sessionStorage, STAY_KEY, '1');
    const context = {
      here: window.location.origin,
      homeUrl,
      failedUntil: readNumber(localStorage, FAILED_KEY),
      stay: readNumber(sessionStorage, STAY_KEY) !== null,
      now: Date.now(),
      pathname: window.location.pathname,
    };
    if (!homeUrl || !shouldProbe(context)) return;
    const controller = new AbortController();
    let timer: number | undefined;
    // Not at home, or switched off: ask again only after a pause.
    const pause = () => write(localStorage, FAILED_KEY, String(Date.now() + FAILURE_PAUSE_MS));
    void (async () => {
      try {
        const config = await getEdgeHome();
        if (!config?.autoConnect || config.homeUrl !== new URL(homeUrl).origin) return pause();
        // The member said no to local network access for this site: asking would only end
        // in a blocked request and a console error.
        if (await localNetworkDenied()) return pause();
        // A plain GET without credentials: no preflight, no cookie of either origin. Chrome
        // asks once whether this site may reach the local network. Away from home the name
        // leads nowhere (or to another network's device without Helena's certificate).
        timer = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
        const answer = await fetch(probeUrl(homeUrl), {
          credentials: 'omit',
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!answer.ok || !isHomeAnswer(await answer.json(), homeUrl)) return pause();
        window.location.replace(homeTarget(homeUrl, window.location));
      } catch {
        pause();
      } finally {
        window.clearTimeout(timer);
      }
    })();
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, []);
  return null;
}
