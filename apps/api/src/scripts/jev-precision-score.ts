import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  acceptsDecision,
  calibrateThreshold,
  scoreDecisions,
  type CalibrationRow,
} from '@helena/decisions';
import type { DecisionClass } from '@helena/sdk';

function required(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}

type Row = CalibrationRow & {
  mode: 'bounded' | 'first-stage';
  repeat: number;
  readiness?: { choice: string; confidence: number };
};
const raw = JSON.parse(await readFile(required('raw'), 'utf8')) as { rows: Row[] };
const snapshot = JSON.parse(await readFile(required('definitions'), 'utf8')) as {
  definitions: { name: string; definition: DecisionClass }[];
};
const manifest = JSON.parse(await readFile(required('split'), 'utf8')) as Record<
  string,
  { tuning: string[]; check: string[] }
>;
const out = resolve(required('out-dir'));
await mkdir(out, { recursive: true });
const selecting = process.argv.includes('--select');
const selected = selecting
  ? ({} as Record<string, number | null>)
  : (JSON.parse(await readFile(required('thresholds'), 'utf8')) as Record<string, number | null>);
const results = [];
for (const { name, definition } of snapshot.definitions) {
  const split = manifest[name];
  if (!split) throw new Error(`Missing split for ${name}`);
  const mine = raw.rows.filter((row) => row.class === name);
  const expected = definition.eval!.cases.flatMap((item) =>
    [0, 1].flatMap((repeat) =>
      (definition.input.cloud === 'allowed' ? ['bounded', 'first-stage'] : ['bounded']).flatMap(
        (mode) =>
          Object.entries(item.expected).map(([question, labels]) => ({
            key: JSON.stringify([item.id, question, repeat, mode]),
            labels: [labels].flat(),
          })),
      ),
    ),
  );
  const given = new Map(
    mine.map((row) => [JSON.stringify([row.case, row.question, row.repeat, row.mode]), row]),
  );
  if (
    given.size !== mine.length ||
    given.size !== expected.length ||
    expected.some(
      (entry) => JSON.stringify(given.get(entry.key)?.expected) !== JSON.stringify(entry.labels),
    )
  )
    throw new Error(`Incomplete, duplicated or relabeled raw data for ${name}`);
  const eligible = (row: Row): Row => {
    if (row.mode !== 'first-stage') return row;
    if (row.readiness?.choice === 'ready')
      return { ...row, confidence: Math.min(row.confidence, row.readiness.confidence) };
    return { ...row, error: row.error ?? 'readiness_escalation' };
  };
  const tuning = mine.filter((row) => split.tuning.includes(row.case)).map(eligible);
  if (selecting) {
    const minimum = ['helena.receipts', 'helena.trading.news'].includes(definition.id)
      ? definition.defaults.threshold
      : 0;
    selected[definition.id] = calibrateThreshold(tuning, minimum);
  }
  const threshold = selected[definition.id];
  if (threshold === undefined) throw new Error(`Missing frozen threshold for ${name}`);
  const parts = selecting ? (['tuning'] as const) : (['tuning', 'check'] as const);
  for (const part of parts) {
    const rows = mine.filter((row) => split[part].includes(row.case));
    for (const mode of ['bounded', 'first-stage'] as const) {
      const scored = rows.filter((row) => (row.mode ?? 'bounded') === mode).map(eligible);
      if (!scored.length) continue;
      const requests = new Map<string, Row[]>();
      for (const row of scored) {
        const key = JSON.stringify([row.case, row.repeat]);
        requests.set(key, [...(requests.get(key) ?? []), row]);
      }
      const acceptedRequests = [...requests.values()].filter((request) =>
        request.every((row) => acceptsDecision(row, threshold)),
      );
      results.push({
        class: name,
        part,
        mode,
        threshold,
        ...scoreDecisions(scored, threshold),
        requests: requests.size,
        acceptedRequests: acceptedRequests.length,
        requestCoverage: acceptedRequests.length / requests.size,
        requestPrecision: acceptedRequests.length
          ? acceptedRequests.filter((request) =>
              request.every((row) => row.expected.includes(row.choice!)),
            ).length / acceptedRequests.length
          : null,
      });
    }
  }
  if (selecting) {
    const wrong = tuning.filter((row) => row.choice !== null && !row.expected.includes(row.choice));
    console.log(`${name}: threshold=${threshold ?? 'abstain'}, tuning failures=${wrong.length}`);
    await writeFile(resolve(out, `${name}-tuning-errors.json`), JSON.stringify(wrong, null, 2));
  }
}
if (selecting) await writeFile(resolve(out, 'thresholds.json'), JSON.stringify(selected, null, 2));
await writeFile(
  resolve(out, selecting ? 'tuning.json' : 'scores.json'),
  JSON.stringify(results, null, 2),
);
