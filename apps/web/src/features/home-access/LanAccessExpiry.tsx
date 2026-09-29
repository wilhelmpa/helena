'use client';

import { useEffect } from 'react';
import { runtimeEnv } from '@/utils/runtimeEnv';
import { isHomeOrigin } from './homeAccess';

// A verified LAN Access token gives this page its hard reload deadline. Reloading
// closes chat streams and tool WebSockets before any subsequent request can reuse an
// expired token; nginx then sends the navigation through Cloudflare's login flow.
export default function LanAccessExpiry() {
  useEffect(() => {
    // Only the home origin (the LAN) has the endpoint; over the tunnel the request only
    // put a red 403 into every page's console (owner, 29.09.).
    if (!isHomeOrigin(window.location.origin, runtimeEnv().homeUrl)) return;
    let expiresAt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const reloadIfExpired = () => {
      if (!expiresAt) return;
      const remaining = expiresAt - Date.now();
      if (remaining <= 0) window.location.reload();
      else timer = setTimeout(reloadIfExpired, Math.min(remaining, 2147483647));
    };
    const check = async () => {
      try {
        const response = await fetch('/backend/auth/verify/lan', {
          credentials: 'same-origin',
          cache: 'no-store',
        });
        if (cancelled) return;
        const seconds = Number(response.headers.get('X-Helena-Access-Expires'));
        if (!response.ok || !Number.isSafeInteger(seconds) || seconds <= 0) return;
        expiresAt = seconds * 1000;
        reloadIfExpired();
      } catch {
        // The public tunnel has no LAN expiry endpoint; its normal Access flow applies.
      }
    };
    void check();
    document.addEventListener('visibilitychange', reloadIfExpired);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', reloadIfExpired);
    };
  }, []);
  return null;
}
