import { describe, expect, it } from 'bun:test';
import { parseTriageResponse } from '../../hub-inbox-contract';

describe('hub inbox contract', () => {
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
