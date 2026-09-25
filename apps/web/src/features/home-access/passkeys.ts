'use client';

import { useHydrated } from '@/components/common/page/useHydrated';
import { runtimeEnv } from '@/utils/runtimeEnv';

// Passkeys are bound to one name (PASSKEY_RP_ID, the public helena.volition.one). WebAuthn
// lets a page use them only on that name or below it, so on the home network's own origin
// (helena-home.volition.one) the browser would refuse: there the LAN sign-in needs none, and
// the pages say where passkeys are added instead of offering a button that cannot work.
export function passkeysUsableOn(rpId: string | undefined, hostname: string): boolean {
  if (!rpId) return true;
  const host = hostname.toLowerCase();
  const id = rpId.toLowerCase();
  return host === id || host.endsWith(`.${id}`);
}

// Where passkeys work, or null when this page is on such an origin. Before hydration the
// server's answer (usable) stands, so both renders match.
export function usePasskeyHome(): string | null {
  const hydrated = useHydrated();
  if (!hydrated) return null;
  const rpId = runtimeEnv().passkeyRpId;
  return rpId && !passkeysUsableOn(rpId, window.location.hostname) ? rpId : null;
}
