// Offline: bun apps/api/src/scripts/jev-news-eval.ts --dry
// Live (Claude only): bun apps/api/src/scripts/jev-news-eval.ts \
//   --base-url https://helena.example/backend --project-key trading --auth-env HELENA_API_KEY \
//   --stage-model jev-1.13.0 --fallback-model local-model --out news-eval.json
// The live mode uses Helena's trading_classify route, not a direct provider endpoint.
// Run it only after a fresh passing class eval on the stage connection and with the
// stage enabled. The two model names must identify distinct stage and local connections.
// The classify reply exposes only the final model: "fallback" below means a regular-model
// result and cannot prove that the stage was attempted on that particular request.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { NEWS_CASES } from '@helena/trading';

type Answer = { choice: string | null; confidence: number | null; decided: boolean };
type Reply = {
  status: string;
  model: string | null;
  threshold: number;
  answers: Record<string, Answer>;
};
type Fixture = {
  fallbackCaseIds: string[];
  overrides: Record<string, Record<string, { choice: string; confidence: number }>>;
};

function option(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? undefined : process.argv[at + 1];
}

function required(name: string): string {
  const value = option(name);
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}

function publicNews(context: string) {
  const parsed: unknown = JSON.parse(context);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('News case is not a public object');
  const item = parsed as Record<string, unknown>;
  if (
    Object.keys(item).sort().join(',') !== 'articleText,instruments' ||
    typeof item.articleText !== 'string' ||
    !Array.isArray(item.instruments) ||
    !item.instruments.every((value) => typeof value === 'string')
  )
    throw new Error('News case contains unexpected fields');
  return { articleText: item.articleText, instruments: item.instruments as string[] };
}

function fixtureReply(
  item: (typeof NEWS_CASES)[number],
  fixture: Fixture,
  stageModel: string,
  fallbackModel: string,
): Reply {
  const answers = Object.fromEntries(
    Object.entries(item.expected).map(([question, expected]) => {
      const override = fixture.overrides[item.id]?.[question];
      const choice = override?.choice ?? [expected].flat()[0]!;
      const confidence = override?.confidence ?? 0.95;
      return [question, { choice, confidence, decided: confidence >= 0.7 }];
    }),
  );
  return {
    status: Object.values(answers).every((answer) => answer.decided) ? 'decided' : 'unsure',
    model: fixture.fallbackCaseIds.includes(item.id) ? fallbackModel : stageModel,
    threshold: 0.7,
    answers,
  };
}

async function liveReply(
  item: (typeof NEWS_CASES)[number],
  baseUrl: string,
  projectKey: string,
  authHeader: string,
  authValue: string,
): Promise<Reply> {
  const url = new URL(
    `${baseUrl.replace(/\/+$/, '')}/projects/${encodeURIComponent(projectKey)}/trading/classify`,
  );
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [authHeader]: authValue },
    body: JSON.stringify({
      kind: 'news',
      publicNews: { ...publicNews(item.context), publicDataConfirmed: true },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Classification HTTP ${response.status}`);
  return (await response.json()) as Reply;
}

function percent(numerator: number, denominator: number): string {
  return denominator ? `${((100 * numerator) / denominator).toFixed(1)}%` : 'n/a';
}

async function main() {
  const dry = process.argv.includes('--dry');
  const stageModel = dry ? 'fixture-stage' : required('stage-model');
  const fallbackModel = dry ? 'fixture-fallback' : required('fallback-model');
  if (stageModel === fallbackModel) throw new Error('Stage and fallback models must differ');
  const fixture = dry
    ? (JSON.parse(
        await readFile(
          fileURLToPath(new URL('./jev-news-eval.fixture.json', import.meta.url)),
          'utf8',
        ),
      ) as Fixture)
    : null;
  const baseUrl = dry ? '' : required('base-url');
  const projectKey = dry ? '' : required('project-key');
  const authHeader = option('auth-header') ?? 'x-api-key';
  if (!['x-api-key', 'authorization', 'cookie'].includes(authHeader))
    throw new Error('Unsupported authentication header');
  const authValue = dry ? '' : process.env[required('auth-env')];
  if (!dry && !authValue) throw new Error('Authentication environment variable is empty');
  const scores = Object.fromEntries(
    ['relevance', 'direction', 'event'].map((key) => [
      key,
      { total: 0, correct: 0, answered: 0, correctAnswered: 0 },
    ]),
  );
  const cases: { id: string; model: string | null; status: string; fallback: boolean }[] = [];
  const errors: { id: string; error: string }[] = [];
  const failures: {
    id: string;
    question: string;
    expected: string[];
    got: string | null;
    confidence: number | null;
  }[] = [];
  let fallback = 0;
  let stage = 0;
  for (const item of NEWS_CASES) {
    try {
      publicNews(item.context);
      const reply = fixture
        ? fixtureReply(item, fixture, stageModel, fallbackModel)
        : await liveReply(item, baseUrl, projectKey, authHeader, authValue!);
      if (!['decided', 'unsure'].includes(reply.status) || !reply.model)
        throw new Error(`No usable decision for ${item.id}: ${reply.status}`);
      if (![stageModel, fallbackModel].includes(reply.model))
        throw new Error(`Unexpected model for ${item.id}: ${reply.model}`);
      const usedFallback = reply.model === fallbackModel;
      if (usedFallback) fallback++;
      if (reply.model === stageModel) stage++;
      cases.push({ id: item.id, model: reply.model, status: reply.status, fallback: usedFallback });
      for (const [question, expected] of Object.entries(item.expected)) {
        const score = scores[question];
        if (!score) throw new Error(`Unknown question ${question}`);
        const answer = reply.answers?.[question];
        const correct = !!answer?.choice && [expected].flat().includes(answer.choice);
        const answered =
          !!answer?.decided &&
          typeof answer.confidence === 'number' &&
          answer.confidence >= reply.threshold;
        score.total++;
        if (correct) score.correct++;
        if (answered) score.answered++;
        if (correct && answered) score.correctAnswered++;
        if (!correct || !answered)
          failures.push({
            id: item.id,
            question,
            expected: [expected].flat(),
            got: answer?.choice ?? null,
            confidence: answer?.confidence ?? null,
          });
      }
    } catch (error) {
      errors.push({ id: item.id, error: error instanceof Error ? error.message : String(error) });
      for (const score of Object.values(scores)) score.total++;
    }
  }
  if (NEWS_CASES.length !== 24 || Object.values(scores).some((score) => score.total !== 24))
    throw new Error('Expected exactly 24 news cases and 72 questions');
  for (const [question, score] of Object.entries(scores))
    console.log(
      `${question}: Treffer ${percent(score.correct, score.total)}, ` +
        `Präzision ≥0,70 ${percent(score.correctAnswered, score.answered)}, ` +
        `Abdeckung ${percent(score.answered, score.total)} (${score.answered}/${score.total})`,
    );
  const totals = Object.values(scores).reduce(
    (sum, score) => ({
      total: sum.total + score.total,
      answered: sum.answered + score.answered,
      correctAnswered: sum.correctAnswered + score.correctAnswered,
    }),
    { total: 0, answered: 0, correctAnswered: 0 },
  );
  const precision = totals.answered ? totals.correctAnswered / totals.answered : 0;
  const coverage = totals.answered / totals.total;
  const passed = errors.length === 0 && stage > 0 && precision >= 0.85 && coverage >= 0.5;
  console.log(
    `Gesamt: Präzision ${percent(totals.correctAnswered, totals.answered)}, ` +
      `Abdeckung ${percent(totals.answered, totals.total)}; ${passed ? 'PASS' : 'FAIL'}`,
  );
  console.log(
    `Fallback: ${percent(fallback, NEWS_CASES.length)} (${fallback}/${NEWS_CASES.length} Fälle)`,
  );
  console.log(`Stage: ${stage}/${NEWS_CASES.length} Fälle`);
  console.log(`Fehler: ${errors.length}; 72 Bewertungen`);
  const out = option('out');
  if (out)
    await writeFile(
      out,
      JSON.stringify(
        {
          dry,
          stageModel,
          fallbackModel,
          scores,
          fallback,
          stage,
          passed,
          cases,
          failures,
          errors,
        },
        null,
        2,
      ),
    );
  if (!passed) process.exitCode = 1;
}

await main();
