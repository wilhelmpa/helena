// Types for the plain-JS timing helper used by the voice end-to-end measurement.
export interface VoiceTurnTiming {
  pauseMs: number;
  transcribeMs: number;
  answerMs: number;
  voiceMs: number;
  totalMs: number;
}

export function summarizeVoiceTimings(
  turns: Array<VoiceTurnTiming & Record<string, unknown>>,
  expected: number,
  maxTotal?: number | null,
): VoiceTurnTiming;
