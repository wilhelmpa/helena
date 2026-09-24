// jev-browser (MIT, © Ying-Kai Liao; pinned in package.json), run unchanged as a comparison in
// Browser 2.0 (docs/helena-decisions/browser-task.md §3.5). Never on a project browser: it reads
// password values into what it sends, tags the DOM and evaluates in the page's own world, so it
// gets a throwaway headless Chromium with an empty profile, Chromium's own sandbox, and the
// project's domain rules with local and private addresses closed. Its System One calls go to
// Helena's proxy with the run's one-time token instead of a key (JEV_API_URL/TYPESAFE_API_KEY,
// read once when jev-browser is imported), so every backend works and every token is counted.
//
// Started by the browser router (browser-gateway-server.mjs) with a minimal environment:
//   stdin:  one JSON line {apiUrl, token, model, goal, values, startUrl, maxSteps,
//           allowIrreversible, chromium, domainAllowlist, domainBlocklist}
//   stdout: JSON lines {type: "round", step} …, then {type: "result", result}
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { hostAllowed, isLocalHost } from './domain.ts';

interface LabInput {
  apiUrl: string;
  token: string;
  model: string;
  goal: string;
  values: Record<string, string>;
  startUrl: string;
  maxSteps: number;
  allowIrreversible: boolean;
  chromium: string;
  domainAllowlist: string[];
  domainBlocklist: string[];
}

const STATUS: Record<string, string> = {
  done: 'done',
  likely_done: 'likely_done',
  needs_confirmation: 'needs_confirmation',
  needs_login: 'needs_login',
  error: 'error',
  stuck: 'stuck',
  max_actions: 'max_steps',
  ambiguous: 'needs_agent',
  blocked: 'blocked',
};

function emit(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function readInput(): Promise<LabInput> {
  let data = '';
  for await (const chunk of process.stdin) {
    data += chunk;
    if (data.includes('\n')) break;
  }
  return JSON.parse(data.split('\n')[0]!) as LabInput;
}

// "  r2: click(0.93) -> #14 button "Search" (0.97) value=query …" → a step.
export function roundStep(line: string, n: number) {
  const match = line.match(
    /r\d+:\s+([a-z_]+)\(([\d.]+)\)\s+->\s+#\S+\s+(.*?)\s+\(([\d.]+)\)(?:\s+value=(\S+))?/,
  );
  if (!match) return null;
  return {
    n,
    operation: match[1]!.toUpperCase(),
    element: match[3]!.slice(0, 120),
    probability: Number(match[4]),
    confidence: Number(match[2]),
    ...(match[5] ? { valueKey: match[5] } : {}),
    outcome: 'done',
  };
}

async function main(): Promise<void> {
  const input = await readInput();
  process.env.JEV_API_URL = `${input.apiUrl.replace(/\/+$/, '')}/v1/systemone`;
  process.env.TYPESAFE_API_KEY = input.token;
  process.env.JEV_MODEL = input.model || 'jev-latest';
  const started = Date.now();
  const profile = await mkdtemp(
    path.join(process.env.TMPDIR || os.tmpdir(), 'helena-jev-browser-'),
  );
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launchPersistentContext(profile, {
    executablePath: input.chromium,
    headless: true,
    // Chromium's own sandbox stays on: this browser opens pages of the open web.
    chromiumSandbox: true,
    viewport: { width: 1280, height: 800 },
    locale: 'de-DE',
    args: ['--no-first-run', '--no-default-browser-check'],
  });
  let steps = 0;
  try {
    const policy = {
      domainAllowlist: input.domainAllowlist,
      domainBlocklist: input.domainBlocklist,
    };
    await browser.route('**/*', (route) => {
      try {
        const url = new URL(route.request().url());
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return route.continue();
        if (isLocalHost(url.hostname) || !hostAllowed(policy, url.hostname))
          return route.abort('blockedbyclient');
      } catch {
        return route.abort('blockedbyclient');
      }
      return route.continue();
    });
    const { JevBrowser } = (await import('jev-browser')) as unknown as {
      JevBrowser: new (
        browser: unknown,
        context: unknown,
        own: boolean,
      ) => {
        page: {
          url(): string;
          title(): Promise<string>;
          screenshot(options: object): Promise<Buffer>;
        };
        stats: { calls: number; jev_ms: number; tokens: number };
        open(url: string): Promise<unknown>;
        do(goal: string, options: object): Promise<Record<string, unknown>>;
      };
    };
    const jev = new JevBrowser(null, browser, false);
    jev.page = browser.pages()[0] ?? (await browser.newPage());
    await jev.open(input.startUrl);
    const result = await jev.do(input.goal, {
      values: input.values,
      maxActions: Math.max(1, Math.min(60, input.maxSteps)),
      allowIrreversible: input.allowIrreversible,
      log: (line: string) => {
        const step = roundStep(String(line), steps + 1);
        if (step) {
          steps += 1;
          emit({ type: 'round', step });
        }
      },
    });
    const frame = await jev.page
      .screenshot({ type: 'jpeg', quality: 55 })
      .then((png) => `data:image/jpeg;base64,${png.toString('base64')}`)
      .catch(() => undefined);
    const actions = Array.isArray(result.actions)
      ? (result.actions as Record<string, unknown>[])
      : [];
    emit({
      type: 'result',
      result: {
        status: STATUS[String(result.status)] ?? 'error',
        summary: String(result.info ?? result.status ?? ''),
        url: jev.page.url(),
        title: await jev.page.title().catch(() => ''),
        steps: actions
          .filter((action) => action.action)
          .map((action, index) => ({
            n: index + 1,
            operation: String(action.action).toUpperCase(),
            element: typeof action.element === 'string' ? action.element : null,
            ...(typeof action.value === 'string' ? { valueKey: action.value } : {}),
            outcome: typeof action.error === 'string' ? action.error : 'done',
          })),
        usage: {
          calls: jev.stats.calls,
          inputTokens: jev.stats.tokens,
          outputTokens: 0,
          decisionMs: jev.stats.jev_ms,
        },
        inputTokens: jev.stats.tokens,
        durationMs: Date.now() - started,
        ...(frame ? { finalFrame: frame } : {}),
      },
    });
  } catch (error) {
    emit({
      type: 'result',
      result: {
        status: 'error',
        summary: (error instanceof Error ? error.message : String(error))
          .split('\n')[0]!
          .slice(0, 300),
        durationMs: Date.now() - started,
      },
    });
  } finally {
    await browser.close().catch(() => {});
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

if (import.meta.main) {
  await main();
  process.exit(0);
}
