import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { treaty } from '@elysiajs/eden';
import { app } from '../../app';

// The bearer of the internal orchestration routes and the one Plan sends to the Mastra
// control endpoint. The files are written when this module loads, once per test
// process, because the API caches the tokens it reads first.
const PLAN_CONTROL_TOKEN = 'test-plan-control-token-0123456789abcdef012345';
const MASTRA_CONTROL_TOKEN = 'test-mastra-control-token-0123456789abcdef0123';
const tokenDirectory = mkdtempSync(join(tmpdir(), 'plan-control-'));
for (const [variable, token] of [
  ['PLAN_CONTROL_TOKEN_FILE', PLAN_CONTROL_TOKEN],
  ['MASTRA_CONTROL_TOKEN_FILE', MASTRA_CONTROL_TOKEN],
] as const) {
  const file = join(tokenDirectory, variable);
  writeFileSync(file, token, { mode: 0o600 });
  process.env[variable] = file;
}

// Treaty client that calls the internal routes the way the Hermes team bridge does.
export function controlApi() {
  return treaty(app, { headers: { authorization: `Bearer ${PLAN_CONTROL_TOKEN}` } });
}

export type ControlRequest = Record<string, unknown> & { operation: string };

function defaultAnswer(request: ControlRequest): unknown {
  if (request.operation === 'catalog')
    return {
      catalog: {
        flows: [
          { id: 'agent-team', capabilityRefs: ['hermes-team.v1', 'plan-task-sync.v1'] },
          { id: 'support', capabilityRefs: [] },
        ],
      },
    };
  if (request.operation === 'start')
    return { runId: request.eventId, resourceId: request.projectRef, status: 'running' };
  if (request.operation === 'runs') return { runs: [], total: 0 };
  return {};
}

// A stand-in for the Mastra control endpoint. It records every request and answers
// with `answer`, which a test replaces; a Response is sent as it is.
export const controlPlane = {
  requests: [] as ControlRequest[],
  answer: defaultAnswer as (request: ControlRequest) => unknown,
  // Whether its health endpoint answers, which is how Plan checks Mastra.
  healthy: true,
  reset() {
    this.requests = [];
    this.answer = defaultAnswer;
    this.healthy = true;
  },
  started() {
    return this.requests.filter((request) => request.operation === 'start');
  },
};

const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(request) {
    if (new URL(request.url).pathname === '/healthz')
      return Response.json(
        { ok: controlPlane.healthy },
        { status: controlPlane.healthy ? 200 : 503 },
      );
    if (
      new URL(request.url).pathname !== '/internal/mastra/control' ||
      request.headers.get('authorization') !== `Bearer ${MASTRA_CONTROL_TOKEN}`
    )
      return new Response('Unauthorized', { status: 401 });
    const body = (await request.json()) as ControlRequest;
    controlPlane.requests.push(body);
    const answer = controlPlane.answer(body);
    return answer instanceof Response ? answer : Response.json(answer);
  },
});
server.unref();
process.env.MASTRA_CONTROL_URL = `http://127.0.0.1:${server.port}/internal/mastra/control`;
