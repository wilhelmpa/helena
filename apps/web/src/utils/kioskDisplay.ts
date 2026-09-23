'use client';

import { useSyncExternalStore } from 'react';

// The kiosk on Kingston's own screens (deployment/volition-stack/native/plan-kiosk.sh)
// opens Helena with ?kioskDisplay=single or ?kioskDisplay=dual. With two screens, cage
// extends one window across both, and the tool panel takes the second screen. The value
// is kept for the tab, because in-app navigation drops the query string.
export type KioskDisplay = 'single' | 'dual';

const KEY = 'kiosk:display';

function isKioskDisplay(value: string | null): value is KioskDisplay {
  return value === 'single' || value === 'dual';
}

export function readKioskDisplay(search: string, storage: Pick<Storage, 'getItem' | 'setItem'>) {
  const param = new URLSearchParams(search).get('kioskDisplay');
  if (isKioskDisplay(param)) {
    storage.setItem(KEY, param);
    return param;
  }
  const stored = storage.getItem(KEY);
  return isKioskDisplay(stored) ? stored : null;
}

function snapshot(): KioskDisplay | null {
  try {
    return readKioskDisplay(window.location.search, sessionStorage);
  } catch {
    return null;
  }
}

const subscribe = () => () => {};

export function useKioskDisplay(): KioskDisplay | null {
  return useSyncExternalStore(subscribe, snapshot, () => null);
}
