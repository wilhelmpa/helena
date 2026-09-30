import { expect, test } from 'bun:test';
import { TypeCompiler } from 'elysia/type-system';
import { triageMessageResult } from '../batch-result';
import { TriageBatchResponse } from '../model';

const message = { id: 7265, threadId: 6123 };
const source = {
  messageId: 7265,
  threadId: 6123,
  threadHref: '/project/VOL/inbox?thread=6123',
  receiptIds: [],
  receiptCount: 0,
};

test('successful triage exposes the actual thread independently from the message ID', async () => {
  const result = await triageMessageResult('VOL', message, async () => ({
    status: 'classified',
    issueId: 42,
    actions: [],
  }));
  expect(result).toEqual({ ...source, status: 'classified', issueId: 42, actionFailed: false });
  expect(
    TypeCompiler.Compile(TriageBatchResponse).Check({
      accounts: [],
      processed: 1,
      receiptRetries: 0,
      receiptIds: [],
      receiptCount: 0,
      hasMore: false,
      failed: 0,
      reviewRequired: 0,
      results: [result],
    }),
  ).toBe(true);
});

test('a classification error retains the same readable source and failed status', async () => {
  const result = await triageMessageResult('VOL', message, async () => {
    throw new Error('synthetic classification failure');
  });
  expect(result).toEqual({
    ...source,
    status: 'failed',
    issueId: null,
    actionFailed: true,
    error: 'Classification failed before a result was stored.',
  });
});

test('a stored classification failure exposes its safe service error', async () => {
  const result = await triageMessageResult('VOL', message, async () => ({
    status: 'failed',
    issueId: null,
    actions: [],
    error: 'The decision service answered HTTP 503.',
  }));
  expect(result).toMatchObject({
    status: 'failed',
    error: 'The decision service answered HTTP 503.',
  });
});

test('skipped and action-failed outcomes preserve their existing semantics', async () => {
  expect(await triageMessageResult('VOL', message, async () => null)).toEqual({
    ...source,
    status: 'skipped',
    issueId: null,
    actionFailed: false,
  });
  expect(
    await triageMessageResult('PRIV', message, async () => ({
      status: 'unsure',
      issueId: null,
      actions: [{ kind: 'skipped' }],
    })),
  ).toEqual({
    ...source,
    threadHref: '/project/PRIV/inbox?thread=6123',
    status: 'unsure',
    issueId: null,
    actionFailed: true,
  });
});

test('receipt results include existing and new IDs once, even when another action fails', async () => {
  const result = await triageMessageResult('VOL', message, async () => ({
    status: 'classified',
    issueId: null,
    actions: [
      { kind: 'receipt', receiptIds: [88, 89, 88] },
      { kind: 'receipt', receiptIds: [89, 90] },
      { kind: 'skipped', receiptIds: [99] },
    ],
  }));
  expect(result).toEqual({
    ...source,
    status: 'classified',
    issueId: null,
    actionFailed: true,
    receiptIds: [88, 89, 90],
    receiptCount: 3,
  });
});
