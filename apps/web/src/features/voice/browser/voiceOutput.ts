const output = new Set<symbol>();
const listeners = new Set<() => void>();

export function voiceOutputActive(): boolean {
  return output.size > 0;
}

export function subscribeVoiceOutput(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function markVoiceOutput(id: symbol, active: boolean): void {
  const before = voiceOutputActive();
  if (active) output.add(id);
  else output.delete(id);
  if (before !== voiceOutputActive()) for (const listener of listeners) listener();
}
