// The owner's voice settings as the browser uses them (Lokale KI → Sprache; API
// modules/voice/settings.ts): how long a pause ends a turn, and how fast the local voice
// speaks. The words the recognition should know and the voice and model choices stay on the
// server.

// A pause of 0.6 s ends a turn unless the owner set another (it was a fixed 0.8 s).
export const DEFAULT_PAUSE_MS = 600;
export const PAUSE_MS_RANGE = { min: 300, max: 2000 } as const;

export function clampPause(value: number | null | undefined): number {
  if (!value || !Number.isFinite(value)) return DEFAULT_PAUSE_MS;
  return Math.round(Math.min(PAUSE_MS_RANGE.max, Math.max(PAUSE_MS_RANGE.min, value)));
}
