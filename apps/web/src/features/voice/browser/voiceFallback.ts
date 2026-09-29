// Whether the browser's voice reads at the moment because Helena's could not be reached (a piece
// failed again and again): the composer says so ("Lokale Stimme nicht erreichbar –
// Browserstimme"), so the change of voice is never a surprise. Set by the resilient speaker.

let active = false;
const listeners = new Set<() => void>();

export function voiceFallbackActive(): boolean {
  return active;
}

export function subscribeVoiceFallback(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setVoiceFallback(next: boolean): void {
  if (next === active) return;
  active = next;
  for (const listener of listeners) listener();
}
