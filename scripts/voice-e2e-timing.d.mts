// Types for the plain-JS timing helper used by the voice end-to-end measurement.
export interface VoiceTurnTiming {
  pauseMs: number;
  transcribeMs: number;
  answerMs: number;
  voiceMs: number;
  totalMs: number;
}

export function summarizeVoiceTimings(
  // Checked at run time: incomplete turns throw.
  turns: Array<Record<string, unknown>>,
  expected: number,
  maxTotal?: number | null,
): VoiceTurnTiming;
