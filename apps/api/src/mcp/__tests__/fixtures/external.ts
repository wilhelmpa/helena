import { spyOn } from 'bun:test';
import * as net from '@repo/net';
import * as mail from '@repo/mail';
import * as mailer from '@repo/mailer';
import * as previews from '#modules/project-previews/launcher';
import * as runtime from '#modules/agents/runtime-requests/service';
import * as development from '#modules/development/service';
import { paperExecution } from '#modules/trading/execution';
import type { McpRouteTool } from '../../generate';
import { sample } from '../../../../../../scripts/tool-regression/sample';

let currentTool: McpRouteTool | undefined;
export function selectExternalFixture(tool: McpRouteTool) {
  currentTool = tool;
}

function runnerData(): unknown {
  const branch = currentTool?.outputSchema.anyOf.find((value) => {
    const properties = value.properties as Record<string, { const?: unknown }> | undefined;
    return properties?.ok?.const === true && typeof properties.status?.const === 'number';
  });
  const properties = branch?.properties as Record<string, unknown> | undefined;
  if (!properties) throw new Error('No declared runner response fixture');
  return sample(properties.data);
}

export function installExternalFixtures() {
  paperOrders.clear();
  const mocks = [
    spyOn(globalThis, 'fetch').mockImplementation(externalFixture as typeof fetch),
    spyOn(net, 'pinnedFetch').mockImplementation((raw, init) => externalFixture(raw, init)),
    spyOn(net, 'assertPublicHttpUrl').mockImplementation(async (raw) => new URL(raw)),
    spyOn(mail, 'testImapConnection').mockImplementation(async () => null),
    spyOn(mail, 'testSmtpConnection').mockImplementation(async () => null),
    spyOn(mail, 'sendRawMail').mockImplementation(async () => {}),
    spyOn(mailer, 'sendEmail').mockImplementation(async () => ({ ok: true })),
    // Only the model judgement is synthetic; limits, locks, intents and human
    // strategy approval still use the real private-stack implementation.
    spyOn(paperExecution, 'precheck').mockImplementation(async (_ctx, input) => ({
      allowed: input.check.ok && input.marketOpen && !input.duplicate,
      reason: 'ABSCHLUSSTEST model fixture',
    })),
    spyOn(runtime, 'askRuntime').mockImplementation(
      async <T>(_agentId: number, request: runtime.RuntimeRequest) =>
        (request.op === 'sessions.list'
          ? { sessions: [], total: 0 }
          : request.op === 'sessions.search'
            ? []
            : runnerData()) as T,
    ),
    spyOn(runtime, 'queueRuntimeRequest').mockImplementation(async () => 214),
    spyOn(development, 'developmentOperation').mockImplementation(async <T>() => runnerData() as T),
    spyOn(previews, 'previewLauncher').mockImplementation(
      async <T>() =>
        ({
          preview: {
            name: 'main',
            slug: 'abschlusstest',
            status: 'running',
            url: 'http://127.0.0.1:18444',
            port: 18444,
            command: 'ABSCHLUSSTEST',
            startedAt: 1,
            lastActivityAt: 1,
            idleTimeoutSec: 600,
          },
          previews: [
            {
              name: 'main',
              slug: 'abschlusstest',
              status: 'running',
              url: 'http://127.0.0.1:18444',
              port: 18444,
              command: 'ABSCHLUSSTEST',
              startedAt: 1,
              lastActivityAt: 1,
              idleTimeoutSec: 600,
            },
          ],
          lines: ['ABSCHLUSSTEST'],
        }) as T,
    ),
  ];
  return () => {
    for (const mock of mocks) mock.mockRestore();
  };
}

export const PAPER_ACCOUNT = '00000000-0000-4000-8000-000000000214';
const paperOrders = new Map<string, Record<string, unknown>>();
export function seedCancelablePaperOrder() {
  paperOrders.set(PAPER_ACCOUNT, {
    id: PAPER_ACCOUNT,
    client_order_id: 'ABSCHLUSSTEST cancel fixture',
    symbol: 'AAPL',
    side: 'buy',
    qty: '1',
    filled_qty: '0',
    status: 'new',
    type: 'limit',
    limit_price: '100',
    order_class: 'simple',
  });
}

// Synthetic provider replies. Unknown hosts fail locally before any network call.
export async function externalFixture(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
  if (url.hostname === 'example.test')
    return new Response('<html><h1>ABSCHLUSSTEST</h1></html>', {
      headers: { 'content-type': 'text/html' },
    });
  if (
    ![
      'api.telegram.org',
      'api.notion.com',
      'api.jina.ai',
      'r.jina.ai',
      's.jina.ai',
      'deepsearch.jina.ai',
      'g.jina.ai',
      'api.firecrawl.dev',
      'graph.instagram.com',
      'graph.facebook.com',
      'graph.threads.net',
      'gitea.example.test',
      'paper-api.alpaca.markets',
      'data.alpaca.markets',
    ].includes(url.hostname)
  ) {
    throw new Error(`No ABSCHLUSSTEST provider fixture for ${url.hostname}${url.pathname}`);
  }
  let body: unknown = {
    id: '00000000-0000-4000-8000-000000000214',
    data: [],
    results: [],
    has_more: false,
    next_cursor: null,
    success: true,
    status: 'completed',
    status_code: 'FINISHED',
    ok: true,
    result: { message_id: 214 },
    choices: [{ message: { content: 'ABSCHLUSSTEST' } }],
  };
  if (url.hostname === 'gitea.example.test' && method === 'GET' && url.pathname.endsWith('/issues'))
    body = [];
  if (url.hostname.includes('alpaca')) {
    if (url.pathname.endsWith('/account'))
      body = {
        id: PAPER_ACCOUNT,
        status: 'ACTIVE',
        trading_blocked: false,
        account_blocked: false,
        equity: '10000',
        last_equity: '10000',
        buying_power: '10000',
        cash: '10000',
        currency: 'USD',
        pattern_day_trader: false,
        daytrade_count: 0,
      };
    else if (url.pathname.endsWith('/clock'))
      body = {
        timestamp: new Date().toISOString(),
        is_open: true,
        next_open: new Date(Date.now() + 86400000).toISOString(),
        next_close: new Date(Date.now() + 3600000).toISOString(),
      };
    else if (url.pathname.includes('/assets/'))
      body = {
        symbol: 'AAPL',
        status: 'active',
        tradable: true,
        fractionable: true,
        shortable: false,
        easy_to_borrow: false,
        class: 'us_equity',
      };
    else if (url.pathname.endsWith('/positions'))
      body = [
        {
          symbol: 'AAPL',
          qty: '1',
          market_value: '100',
          avg_entry_price: '100',
          current_price: '100',
        },
      ];
    else if (url.pathname.includes('/positions/'))
      body = {
        symbol: 'AAPL',
        qty: '1',
        market_value: '100',
        avg_entry_price: '100',
        current_price: '100',
      };
    else if (url.pathname.endsWith('/orders:by_client_order_id')) {
      body = [...paperOrders.values()].find(
        (order) => order.client_order_id === url.searchParams.get('client_order_id'),
      );
      if (!body)
        return Response.json({ message: 'ABSCHLUSSTEST order not found' }, { status: 404 });
    } else if (url.pathname.endsWith('/orders') && method === 'POST') {
      const order = JSON.parse(String(init?.body)) as Record<string, unknown>;
      body = {
        ...order,
        id: paperOrders.size === 0 ? PAPER_ACCOUNT : crypto.randomUUID(),
        filled_qty: order.type === 'market' ? order.qty : '0',
        status: order.type === 'market' ? 'filled' : 'new',
        order_class: order.order_class ?? 'simple',
      };
      paperOrders.set(
        (body as Record<string, unknown>).id as string,
        body as Record<string, unknown>,
      );
    } else if (url.pathname.endsWith('/orders')) {
      body = [...paperOrders.values()].filter(
        (order) =>
          url.searchParams.get('status') !== 'open' ||
          !['filled', 'canceled'].includes(String(order.status)),
      );
    } else if (url.pathname.includes('/orders/')) {
      const id = url.pathname.split('/').at(-1)!;
      body = paperOrders.get(id);
      if (!body)
        return Response.json({ message: 'ABSCHLUSSTEST order not found' }, { status: 404 });
      if (method === 'DELETE') {
        (body as Record<string, unknown>).status = 'canceled';
        return new Response(null, { status: 204 });
      }
    } else if (url.pathname.includes('/news')) body = { news: [], next_page_token: null };
    else if (url.pathname.includes('/bars'))
      body = {
        bars: {
          AAPL: Array.from({ length: 250 }, (_, i) => ({
            t: new Date(Date.now() - (251 - i) * 86400000).toISOString(),
            o: 100 + i / 10,
            h: 102 + i / 10,
            l: 98 + i / 10,
            c: 101 + i / 10,
            v: 1000,
          })),
        },
        next_page_token: null,
      };
    else if (url.pathname.endsWith('/trades/latest'))
      body = { trades: { AAPL: { p: 100, t: new Date().toISOString() } } };
    else if (url.pathname.includes('/snapshots'))
      body = {
        AAPL: {
          latestTrade: { p: 100 },
          latestQuote: { ap: 101, bp: 99 },
          dailyBar: { c: 100, o: 99, v: 1000 },
          prevDailyBar: { c: 99 },
        },
      };
  }
  return Response.json(body);
}
