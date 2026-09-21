import { describe, expect, it } from 'bun:test';
import { parseSyncResponse, parseTriageResponse } from '../../hub-inbox-contract';

describe('hub inbox contract', () => {
  it('accepts bounded sync metadata and trims no identifiers', () => {
    const result = parseSyncResponse({
      sources: [
        {
          channel: 'mail',
          account: 'team@example.com',
          status: 'connected',
          cursor: 'history-2',
          error: null,
          events: [
            {
              externalEventId: 'history-2:message-1',
              externalThreadId: 'thread-1',
              externalMessageId: 'message-1',
              sender: 'Customer <customer@example.com>',
              subject: 'Need help',
              snippet: 'A bounded preview',
              receivedAt: '2026-09-21T08:00:00.000Z',
            },
          ],
        },
      ],
    });
    expect(result[0]?.events[0]).toMatchObject({
      externalEventId: 'history-2:message-1',
      externalThreadId: 'thread-1',
    });
  });

  it('rejects oversized batches and invalid provider timestamps', () => {
    const event = {
      externalEventId: 'e',
      externalThreadId: 't',
      externalMessageId: 'm',
      sender: 's',
      receivedAt: 'not-a-date',
    };
    expect(() =>
      parseSyncResponse({
        sources: [{ channel: 'mail', account: 'a', status: 'connected', events: [event] }],
      }),
    ).toThrow('Invalid sync response');
    expect(() =>
      parseSyncResponse({
        sources: [
          {
            channel: 'mail',
            account: 'a',
            status: 'connected',
            events: Array.from({ length: 101 }, () => ({
              ...event,
              receivedAt: new Date().toISOString(),
            })),
          },
        ],
      }),
    ).toThrow('Invalid sync response');
    expect(() =>
      parseSyncResponse({
        sources: Array.from({ length: 51 }, (_, index) => ({
          channel: 'mail',
          account: `account-${index}@example.com`,
          status: 'connected',
          events: [],
        })),
      }),
    ).toThrow('Invalid sync response');
  });

  it('whitelists triage output and supports asynchronous run ids', () => {
    expect(parseTriageResponse({ status: 'queued', runId: 'run-1', secret: 'ignored' })).toEqual({
      status: 'queued',
      runId: 'run-1',
    });
    expect(
      parseTriageResponse({
        status: 'completed',
        result: {
          summary: 'Create a support task',
          priority: 'high',
          requiresAction: true,
          projectKey: 'help',
          issueIdentifier: null,
          confidence: 0.93,
          externalUrl: 'https://attacker.invalid',
        },
      }),
    ).toEqual({
      status: 'completed',
      result: {
        summary: 'Create a support task',
        priority: 'high',
        requiresAction: true,
        projectKey: 'HELP',
        issueIdentifier: null,
        confidence: 0.93,
      },
    });
  });
});
