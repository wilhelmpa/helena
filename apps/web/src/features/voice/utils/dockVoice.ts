let requested = false;
const listeners = new Set<() => void>();

export function requestDockVoice() {
  requested = true;
  for (const listener of listeners) listener();
}

export function listenDockVoice(start: () => void) {
  const run = () => {
    if (!requested) return;
    requested = false;
    start();
  };
  listeners.add(run);
  run();
  return () => {
    listeners.delete(run);
  };
}
