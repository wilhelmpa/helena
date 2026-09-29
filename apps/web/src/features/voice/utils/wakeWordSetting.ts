const KEY = 'volition.voice.wakeWord';
const EVENT = 'volition:voice-wake-word';

export function wakeWordEnabled(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(KEY) === 'true';
  } catch {
    return false;
  }
}

export function setWakeWordEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(KEY, String(enabled));
  } catch {
    return;
  }
  window.dispatchEvent(new Event(EVENT));
}

export function subscribeWakeWordSetting(listener: () => void): () => void {
  window.addEventListener(EVENT, listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener('storage', listener);
  };
}
