// Where the time of one conversation turn goes, measured in the browser: from the moment the
// owner stopped speaking to the first sound of the answer. The parts add up to the total:
//
//   pause       the ear waits this long before it decides the owner is done (its setting);
//   transcribe  the recording goes to the model and comes back as text;
//   answer      the message is sent and the first words of the answer arrive;
//   voice       the first sentence is turned into sound and starts playing.
//
// Shown on the conversation line ("Antwort nach 1,4 s") and read by the voice E2E.

export interface TurnMarks {
  // performance.now() values.
  stoppedAt: number;
  heardAt: number;
  transcribedAt?: number;
  sentAt?: number;
  answerAt?: number;
  firstSoundAt?: number;
  firstSoundKind?: 'bridge' | 'answer';
}

export interface TurnTimings {
  pauseMs: number;
  transcribeMs: number;
  answerMs: number;
  voiceMs: number;
  totalMs: number;
  firstSoundMs?: number;
  firstSoundKind?: 'bridge' | 'answer';
}

export function turnTimings(marks: TurnMarks & { audibleAt: number }): TurnTimings {
  const transcribed = marks.transcribedAt ?? marks.heardAt;
  const sent = Math.max(marks.sentAt ?? transcribed, transcribed);
  const answer = Math.max(marks.answerAt ?? sent, sent);
  const audible = Math.max(marks.audibleAt, answer);
  const round = (value: number) => Math.max(0, Math.round(value));
  return {
    pauseMs: round(marks.heardAt - marks.stoppedAt),
    // Sending takes a few milliseconds; it counts to the transcription.
    transcribeMs: round(sent - marks.heardAt),
    answerMs: round(answer - sent),
    voiceMs: round(audible - answer),
    totalMs: round(audible - marks.stoppedAt),
    ...(marks.firstSoundAt && {
      firstSoundMs: round(marks.firstSoundAt - marks.stoppedAt),
      firstSoundKind: marks.firstSoundKind,
    }),
  };
}
