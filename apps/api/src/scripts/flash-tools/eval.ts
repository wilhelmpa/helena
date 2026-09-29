import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toMcpTool } from '@helena/sdk';
import { db } from '@repo/db';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import type { JsonSchemaType } from '@modelcontextprotocol/sdk/validation/types.js';
import { sql } from 'drizzle-orm';
import { runAgent } from '../../../../../packages/agent-runtime/src/agent';
import type { AgentRuntimeConfig } from '../../../../../packages/agent-runtime/src/config';
import { MemorySink } from '../../../../../packages/agent-runtime/src/events';
import type {
  AgentTool,
  JsonSchemaObject,
} from '../../../../../packages/agent-runtime/src/tools/types';
import { BROWSER_TOOLS } from '../../../../../packages/browser-gateway/src/tools';
import { app } from '../../app';
import { routeTools, withoutFields } from '../../mcp/generate';
import { registries } from '../../shared/helena';
import { HalogenHealthGate } from './health';
import { inventory } from './inventory';

type Case = {
  id: string;
  group: string;
  tool: string;
  alternates?: string[];
  chain?: string[];
  results?: Record<string, string>;
  profile?: 'recherche' | 'coder-lite';
  prompt: string;
  result: string;
  answer: string;
};

type EvalRow = {
  id: string;
  group: string;
  passed: boolean;
  target: boolean;
  wrong: string[];
  invalid: number;
  nonSchemaErrors: number;
  schemaErrors: number;
  unrepairedSchemaErrors: number;
  repeatedCalls: number;
  inputTokens: number;
  durationMs: number;
  [key: string]: unknown;
};

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? undefined : process.argv[index + 1];
}

function assertPrivateDatabase(): void {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    url.port === '5432' ||
    !url.pathname.match(/(?:_test|_eval)$/)
  ) {
    throw new Error(
      'A private loopback Postgres on a non-default port and *_test/_eval DB is required',
    );
  }
}

function definitions(fixture: Case): AgentTool[] {
  const validator = new AjvJsonSchemaValidator();
  const routes = routeTools(app).filter(
    (entry) => !entry.connector || (fixture.group === 'kalender' && entry.connector === 'google'),
  );
  const names = new Set(routes.map((entry) => entry.name));
  const definitions = [
    ...routes.map((entry) => ({
      name: entry.name,
      description: entry.description,
      inputSchema: (entry.pathParams.includes('teamId')
        ? withoutFields(entry.inputSchema, ['teamId'])
        : entry.inputSchema) as unknown as JsonSchemaObject,
      readOnly: entry.annotations.readOnlyHint === true,
      kind: 'normal' as const,
    })),
    ...registries.tools
      .list()
      .filter(
        (entry) =>
          !names.has(entry.name) &&
          fixture.group === 'trading-lesetools' &&
          entry.name === 'alpaca_paper_positions',
      )
      .map((entry) => {
        const tool = toMcpTool(entry);
        return {
          name: tool.name,
          description: tool.description ?? tool.name,
          inputSchema: tool.inputSchema as JsonSchemaObject,
          readOnly: tool.annotations?.readOnlyHint === true,
          kind: 'normal' as const,
        };
      }),
    ...BROWSER_TOOLS.filter(() => fixture.profile === 'recherche').map((entry) => ({
      name: entry.name,
      description: entry.description,
      inputSchema: entry.inputSchema as JsonSchemaObject,
      readOnly: entry.category === 'read',
      kind: 'browser' as const,
    })),
    ...(fixture.group === 'externes-mcp'
      ? [
          {
            name: 'fixture__lookup',
            description: 'Look up an item by its id in the local fixture catalog.',
            inputSchema: {
              type: 'object' as const,
              properties: { id: { type: 'string' } },
              required: ['id'],
            },
            readOnly: true,
            kind: 'normal' as const,
          },
        ]
      : []),
  ];
  return definitions.map((entry) => {
    return {
      ...entry,
      async execute(input) {
        let checked: ReturnType<ReturnType<typeof validator.getValidator>>;
        try {
          checked = validator.getValidator(entry.inputSchema as JsonSchemaType)(input);
        } catch (error) {
          return { text: `Invalid fixture schema: ${String(error)}`, isError: true };
        }
        if (!checked.valid)
          return {
            text: `Invalid fixture arguments: ${checked.errorMessage}`,
            isError: true,
          };
        if (entry.name === 'browser_navigate') {
          try {
            if (new URL(String(input.url)).hostname !== '127.0.0.1')
              return { text: 'Only local browser fixtures are allowed.', isError: true };
          } catch {
            return { text: 'A local fixture URL is required.', isError: true };
          }
        }
        const active = currentCase;
        if (!active) return { text: 'No active fixture.', isError: true };
        if (active.results?.[entry.name])
          return { text: active.results[entry.name], changed: !entry.readOnly };
        if (entry.name === 'get_project')
          return {
            text: 'Projekt VOL105: Spalte „Offen“ hat columnId 1; Team-ID 1. Aufgaben VOL105-7 und VOL105-8 existieren.',
          };
        if (entry.name === 'list_projects') return { text: 'Testprojekt VOL105 ist verfügbar.' };
        if (entry.name === 'list_teams') return { text: 'Testteam mit teamId 1.' };
        if (entry.name === 'get_issue_by_number' || entry.name === 'get_issue') {
          const issueId = Number(input.issueId ?? input.sequenceNumber);
          if (issueId !== 7 && issueId !== 8)
            return { text: `Aufgabe ${issueId} nicht gefunden.`, isError: true };
          return {
            text: `Aufgabe VOL105-${issueId} hat issueId ${issueId}, gehört zu VOL105 und ist offen.`,
          };
        }
        if (entry.name === 'list_issues')
          return {
            text: 'Projekt VOL105 enthält Aufgabe VOL105-7 (issueId 7) und VOL105-8 (issueId 8).',
          };
        if (entry.name === 'search_issues' && active.tool === 'create_issue')
          return { text: 'Keine bestehende Aufgabe mit diesem Titel im Projekt VOL105.' };
        if (entry.name === 'list_issue_activity') {
          const issueId = Number(input.issueId);
          return issueId === 8
            ? { text: 'Die Aufgabe VOL105-8 hat den Kommentar „Beleg fehlt“ (ID 1052).' }
            : { text: 'Die Aufgabe VOL105-7 hat den Kommentar „Geprüft“ (ID 1051).' };
        }
        if (entry.name === 'search_mail')
          return { text: 'Testmail 105 gehört zum Thread 105 im Projekt VOL105.' };
        if (entry.name === 'read_mail')
          return { text: 'Mailthread 105: Bitte um Rückmeldung morgen.' };
        if (entry.name === 'list_members')
          return {
            text: 'Projektmitglied Owner ist aktiv. Die Agentenzuordnung steht in list_ai_agents.',
          };
        if (entry.name === 'get_ai_agent' && active.group === 'agenten') {
          const agentId = Number(input.agentId);
          const name = agentId === 105 ? 'Lumen' : agentId === 106 ? 'Nova' : null;
          return name
            ? { text: `Agent ${name} (ID ${agentId}) ist VOL105 zugeordnet und aktiv.` }
            : { text: `Agent ${agentId} nicht gefunden.`, isError: true };
        }
        if (entry.name === 'list_decisions' && active.tool === 'decide')
          return { text: active.result };
        if (entry.name === 'list_connections')
          return { text: 'Google-Testkonto test-kalender@example.com ist für VOL105 verbunden.' };
        if (entry.name === 'get_project_goal_context')
          return { text: 'VOL105 hat Projektziele; list_goals liefert die aktuelle Zielliste.' };
        if (entry.name === 'list_folder')
          return {
            text: 'Projektwissen VOL105 enthält Testplan.md mit Testfreigabe am 17. Oktober.',
          };
        if (entry.name === 'search_knowledge' && entry.name !== active.tool)
          return { text: 'Im Projektwissen kein passender Eintrag.' };
        if (entry.name !== active.tool)
          return { text: 'This tool has no result for the current fixture.', isError: true };
        return { text: active.result, changed: !entry.readOnly };
      },
    };
  });
}

let currentCase: Case | null = null;

async function main(): Promise<void> {
  assertPrivateDatabase();
  await db.execute(sql`select 1`);
  const cases = (await Bun.file(
    new URL('./fixtures/cases.json', import.meta.url),
  ).json()) as Case[];
  const only = option('only')?.split(',');
  const output = option('out');
  if (process.argv.includes('--resume') && !output) throw new Error('--resume requires --out');
  const resumedRows = process.argv.includes('--resume')
    ? (JSON.parse(await Bun.file(`${output}.partial`).text()) as EvalRow[])
    : [];
  const completed = new Set(resumedRows.map((row) => row.id));
  const selected = cases.filter(
    (entry) => (!only || only.includes(entry.id)) && !completed.has(entry.id),
  );
  if (selected.length === 0 && resumedRows.length === 0) throw new Error('No fixtures selected');
  const model = option('model') ?? 'halogen-qwen3.8-flash-next';
  const provider = option('provider') ?? 'helena-halogen';
  const baseUrl = option('base-url') ?? 'http://127.0.0.1:8731/v1';
  if (new URL(baseUrl).hostname !== '127.0.0.1')
    throw new Error('Only a local model endpoint or local health proxy is allowed');
  const health = new HalogenHealthGate(
    option('health-url') ?? 'http://127.0.0.1:8731/health',
    option('health-log'),
  );
  await health.start();
  const upstreamFetch = globalThis.fetch;
  const gatedFetch: typeof fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith(baseUrl)) {
        await health.waitIdle();
        await health.setRequest(init?.body);
      }
      return upstreamFetch(input, init);
    },
    { preconnect: upstreamFetch.preconnect },
  );
  globalThis.fetch = gatedFetch;
  const rows: EvalRow[] = resumedRows;
  for (const fixture of selected) {
    currentCase = fixture;
    const workdir = await mkdtemp(join(tmpdir(), 'volition-flash-tools-'));
    const git = Bun.spawnSync(['git', 'init', '-q', '-b', 'flash-eval'], { cwd: workdir });
    if (git.exitCode !== 0) throw new Error('Could not initialize the fixture repository');
    await writeFile(
      join(workdir, 'bericht.txt'),
      'Testfreigabe: 17. Oktober.\nAufbewahrungsfrist: 30 Tage.\nStatus: offen.\n',
    );
    const tools = definitions(fixture);
    const config: AgentRuntimeConfig = {
      model: `${provider}/${model}`,
      servers: [
        { provider, kind: 'openai-compatible', baseUrl, local: true, thinkingSwitch: true },
      ],
      workdir,
      tools: {
        profile: fixture.profile ?? 'assistent',
        ...(fixture.profile === 'coder-lite' ? { allowUnsandboxedShell: true } : {}),
      },
      memory: { enabled: false },
      policy: 'allow',
      limits: { maxTurns: 12, runBudgetSeconds: 180 },
    };
    const runFixture = async () => {
      const sink = new MemorySink();
      const stopWatch = health.watchCase();
      let result: Awaited<ReturnType<typeof runAgent>>;
      try {
        result = await runAgent({
          config,
          prompt: fixture.prompt,
          sink,
          env: process.env,
          signal: new AbortController().signal,
          helena: null,
          extraTools: tools,
        });
      } finally {
        await stopWatch();
      }
      await health.waitIdle();
      return { sink, result };
    };
    const beforeHangs = health.hangCount;
    const beforeContamination = health.contaminationCount;
    let measured = await runFixture();
    if (
      health.hangCount > beforeHangs ||
      health.contaminationCount > beforeContamination ||
      measured.result.reason === 'model-unavailable'
    ) {
      process.stderr.write(`${fixture.id}: retry after Halogen outage or overlapping traffic\n`);
      measured = await runFixture();
    }
    const { sink, result } = measured;
    const calls = sink.of('tool-call');
    const results = sink.of('tool-result');
    const resultsById = new Map(results.map((event) => [event.id, event]));
    const schemaError = (output: string) =>
      /arguments did not match|Invalid fixture (arguments|schema)|valid JSON|JSON parse/i.test(
        output,
      );
    const schemaErrors = calls.filter((event) =>
      schemaError(resultsById.get(event.id)?.output ?? ''),
    );
    const unrepairedSchemaErrors = schemaErrors.filter((event) => {
      const index = calls.indexOf(event);
      return !calls
        .slice(index + 1)
        .some((later) => later.name === event.name && resultsById.get(later.id)?.isError !== true);
    }).length;
    const signatures = new Set<string>();
    let repeatedCalls = 0;
    for (const event of calls) {
      const signature = `${event.name}:${event.input}`;
      if (signatures.has(signature)) repeatedCalls += 1;
      signatures.add(signature);
    }
    const expected = fixture.chain ?? [fixture.tool];
    const acceptable = new Set([fixture.tool, ...(fixture.alternates ?? [])]);
    let matched = 0;
    for (const event of calls) if (event.name === expected[matched]) matched += 1;
    const target = fixture.chain
      ? matched === expected.length
      : calls.some((event) => acceptable.has(event.name));
    const wrong = calls.filter(
      (event) =>
        ![
          'find_tools',
          'get_project',
          'list_projects',
          'list_teams',
          'get_issue_by_number',
          'get_issue',
          'list_issues',
          ...(fixture.tool === 'create_issue' ? ['search_issues'] : []),
          'list_issue_activity',
          'search_mail',
          'read_mail',
          'list_members',
          ...(fixture.group === 'agenten' ? ['get_ai_agent'] : []),
          'get_project_goal_context',
          ...(fixture.tool === 'decide' ? ['list_decisions'] : []),
          'list_connections',
          'list_folder',
          ...(fixture.profile === 'coder-lite' ? ['read_file', 'list_files', 'search_files'] : []),
          ...expected,
          ...(fixture.alternates ?? []),
        ].includes(event.name),
    );
    const invalid = results.filter((event) => event.isError).length;
    const nonSchemaErrors = invalid - schemaErrors.length;
    const usedResult = result.text.toLowerCase().includes(fixture.answer.toLowerCase());
    const passed =
      result.status === 'success' &&
      target &&
      wrong.length === 0 &&
      nonSchemaErrors === 0 &&
      unrepairedSchemaErrors === 0 &&
      usedResult;
    rows.push({
      id: fixture.id,
      group: fixture.group,
      expected: fixture.tool,
      passed,
      target,
      wrong: wrong.map((event) => event.name),
      invalid,
      nonSchemaErrors,
      schemaErrors: schemaErrors.length,
      unrepairedSchemaErrors,
      repeatedCalls,
      usedResult,
      tools: calls.map((event) => event.name),
      toolTrace: calls.map((event) => {
        const output = resultsById.get(event.id);
        return {
          name: event.name,
          input: event.input,
          isError: output?.isError ?? false,
          output: output?.output.slice(0, 500) ?? '',
        };
      }),
      inputTokens: result.spend.inputTokens,
      durationMs: result.spend.durationMs,
      status: result.status,
      reason: result.reason,
      error: result.error,
      answer: result.text,
    });
    process.stderr.write(`${fixture.id}: ${passed ? 'PASS' : 'FAIL'}\n`);
    await rm(workdir, { recursive: true, force: true });
    if (output) await writeFile(`${output}.partial`, JSON.stringify(rows) + '\n');
  }
  currentCase = null;
  const groups = Object.fromEntries(
    [...new Set(rows.map((row) => row.group))].map((group) => {
      const groupRows = rows.filter((row) => row.group === group);
      return [
        group,
        {
          passed: groupRows.filter((row) => row.passed).length,
          total: groupRows.length,
          correctTool: groupRows.filter((row) => row.target && row.wrong.length === 0).length,
          toolErrors: groupRows.reduce((sum, row) => sum + row.invalid, 0),
          schemaErrors: groupRows.reduce((sum, row) => sum + row.schemaErrors, 0),
          unrepairedSchemaErrors: groupRows.reduce(
            (sum, row) => sum + row.unrepairedSchemaErrors,
            0,
          ),
          repeatedCalls: groupRows.reduce((sum, row) => sum + row.repeatedCalls, 0),
          inputTokens: groupRows.reduce((sum, row) => sum + row.inputTokens, 0),
          durationMs: groupRows.reduce((sum, row) => sum + row.durationMs, 0),
        },
      ];
    }),
  );
  const inventoried = inventory();
  const covered = new Set(cases.flatMap((fixture) => fixture.chain ?? [fixture.tool]));
  const report = {
    model: `${provider}/${model}`,
    fixtureCount: cases.length,
    coverage: {
      inventoriedTools: inventoried.length,
      toolsWithCases: inventoried.filter((entry) => covered.has(entry.name)).length,
    },
    groups,
    rows,
  };
  if (output) await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  if (output) await rm(`${output}.partial`, { force: true });
  process.stdout.write(JSON.stringify(report) + '\n');
  globalThis.fetch = upstreamFetch;
  process.exit(rows.every((row) => row.passed) ? 0 : 1);
}

if (import.meta.main) await main();
