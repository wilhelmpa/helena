'use client';

import { useSyncExternalStore } from 'react';
import {
  setWakeWordEnabled,
  subscribeWakeWordSetting,
  wakeWordEnabled,
} from '../utils/wakeWordSetting';

export function useWakeWordSetting() {
  const enabled = useSyncExternalStore(subscribeWakeWordSetting, wakeWordEnabled, () => false);
  return { enabled, setEnabled: setWakeWordEnabled };
}
