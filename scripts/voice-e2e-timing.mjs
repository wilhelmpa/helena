export function summarizeVoiceTimings(turns, expected, maxTotal = null) {
  if (turns.length !== expected)
    throw new Error(`not all requested answers were timed: ${turns.length}/${expected}`);
  if (expected < 1) throw new Error('at least one answer is required');
  const keys = ['pauseMs', 'transcribeMs', 'answerMs', 'voiceMs', 'totalMs'];
  if (turns.some((turn) => keys.some((key) => !Number.isFinite(turn[key]) || turn[key] < 0)))
    throw new Error('incomplete timing of a spoken answer');
  const summary = Object.fromEntries(
    keys.map((key) => {
      const sorted = turns.map((turn) => turn[key]).sort((a, b) => a - b);
      return [
        key,
        (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2,
      ];
    }),
  );
  if (maxTotal !== null && summary.totalMs >= maxTotal)
    throw new Error(`median answer ${summary.totalMs} ms >= ${maxTotal} ms`);
  return summary;
}
