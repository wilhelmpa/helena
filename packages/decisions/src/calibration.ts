export interface CalibrationRow {
  class: string;
  case: string;
  question: string;
  expected: string[];
  choice: string | null;
  confidence: number;
  error?: string;
}

export function splitDecisionCases(ids: readonly string[]) {
  const ordered = [...new Set(ids)].sort((a, b) => {
    const left = a.replace(/^precheck\./, '');
    const right = b.replace(/^precheck\./, '');
    if (left < right) return -1;
    if (left > right) return 1;
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  });
  return {
    tuning: ordered.filter((_, index) => index % 2 === 0),
    check: ordered.filter((_, index) => index % 2 === 1),
  };
}

export function acceptsDecision(row: CalibrationRow, threshold: number | null): boolean {
  return (
    threshold !== null &&
    !row.error &&
    row.choice !== null &&
    !['uncertain', 'unsure'].includes(row.choice) &&
    Number.isFinite(row.confidence) &&
    row.confidence >= 0 &&
    row.confidence <= 1 &&
    row.confidence >= threshold
  );
}

export function scoreDecisions(rows: readonly CalibrationRow[], threshold: number | null) {
  const accepted = rows.filter((row) => acceptsDecision(row, threshold));
  const correct = (row: CalibrationRow) => row.choice !== null && row.expected.includes(row.choice);
  const correctAccepted = accepted.filter(correct).length;
  return {
    questions: rows.length,
    accepted: accepted.length,
    correctAccepted,
    precision: accepted.length ? correctAccepted / accepted.length : null,
    coverage: rows.length ? accepted.length / rows.length : 0,
    accuracy: rows.length ? rows.filter(correct).length / rows.length : 0,
  };
}

export function calibrateThreshold(tuning: readonly CalibrationRow[], minimum = 0): number | null {
  const candidates = [
    ...new Set([minimum, ...tuning.map((row) => Math.floor(row.confidence * 1000 + 1) / 1000)]),
  ]
    .filter((value) => Number.isFinite(value) && value >= minimum && value <= 1)
    .sort((a, b) => a - b);
  for (const threshold of candidates) {
    const score = scoreDecisions(tuning, threshold);
    if (score.accepted > 0 && score.precision === 1) return threshold;
  }
  return null;
}
