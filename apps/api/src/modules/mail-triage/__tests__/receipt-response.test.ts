import { expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { routeTools, mcpTool } from '#mcp/generate';
import { structuredResult } from '#mcp/result';
import { receiptSummary, triageMessageResult } from '../batch-result';
import { TriageBatchResponse } from '../model';

test('HTTP serialization and the MCP envelope retain first-run and retry receipt identities', async () => {
  const first = await triageMessageResult('SYNTH', { id: 7, threadId: 9 }, async () => ({
    status: 'classified',
    issueId: null,
    actions: [{ kind: 'receipt', receiptIds: [41, 42, 41] }],
  }));
  const retryIds = [42, 43];
  const payload = {
    accounts: [],
    processed: 1,
    receiptRetries: 1,
    hasMore: false,
    failed: 0,
    reviewRequired: 0,
    results: [first],
    ...receiptSummary([...retryIds, ...first.receiptIds]),
  };
  // Exercises actual Elysia serialization and the MCP envelope; route authorization is
  // covered by the private-DB production-route test in decisions.test.ts.
  const app = new Elysia().post('/triage', () => payload, {
    response: { 200: TriageBatchResponse },
    detail: mcpTool('run_mail_triage'),
  });
  const response = await app.handle(new Request('http://localhost/triage', { method: 'POST' }));
  const text = await response.text();
  expect(response.status).toBe(200);
  expect(JSON.parse(text)).toMatchObject({
    receiptCount: 3,
    receiptIds: [42, 43, 41],
    receiptRetries: 1,
    results: [{ receiptCount: 2, receiptIds: [41, 42] }],
  });
  const tool = routeTools(app)[0]!;
  const envelope = structuredResult(response, text, tool.method, tool.outputSchema);
  expect(envelope).toEqual({ ok: true, status: 200, data: JSON.parse(text) });
  expect(JSON.stringify(tool.outputSchema)).toContain('receiptCount');
  expect(JSON.stringify(tool.outputSchema)).toContain('receiptIds');
});

test('a late classification failure exposes no unconfirmed receipt IDs', async () => {
  const failed = await triageMessageResult('SYNTH', { id: 7, threadId: 9 }, async () => {
    throw new Error('Persisted receipt but final classification read failed');
  });
  expect(failed).toMatchObject({
    status: 'failed',
    actionFailed: true,
    receiptIds: [],
    receiptCount: 0,
  });
});
