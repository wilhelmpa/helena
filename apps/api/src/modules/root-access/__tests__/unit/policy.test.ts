import { describe, expect, it } from 'bun:test';
import { toolsFullyObserved } from '@helena/sdk';
import { workFromHeaders } from '../../provenance';
import { persistenceMarkers, rootDecision, taintSourcesOf } from '../../policy';

describe('root provenance matrix', () => {
  for (const origin of ['owner-direct', 'system'])
    for (const runtime of ['hermes', 'codex'])
      for (const tainted of [false, true]) {
        it(`${origin} / ${runtime} / taint=${tainted}`, () => {
          expect(
            rootDecision({
              origin,
              runtime,
              taintSources: tainted ? ['mail'] : [],
              directOnly: true,
            }),
          ).toBe(
            origin === 'owner-direct' && runtime === 'hermes' && !tainted
              ? 'immediate'
              : 'approval',
          );
        });
      }
  it('never trusts unobserved runtimes, even with directOnly off', () => {
    for (const runtime of ['claude', 'codex', 'unknown']) {
      expect(toolsFullyObserved(runtime)).toBe(false);
      expect(
        rootDecision({ origin: 'owner-direct', runtime, taintSources: [], directOnly: false }),
      ).toBe('approval');
    }
    expect(toolsFullyObserved('central')).toBe(true);
    expect(toolsFullyObserved('hermes')).toBe(true);
    // Ava's own runtime runs every tool call through the Helena loop, so it is observed.
    expect(toolsFullyObserved('helena')).toBe(true);
  });
  it('tracks all external sources, including read-only MCP and code execution', () => {
    for (const [tool, source] of [
      ['read_mail', 'mail'],
      ['browser_snapshot', 'browser'],
      ['WebSearch', 'web'],
      ['read_knowledge', 'knowledge'],
      ['terminal', 'execution'],
      ['execute_code', 'execution'],
      ['Read', 'outside-workspace'],
    ]) {
      expect(taintSourcesOf({ tool: tool! })).toContain(source!);
    }
    expect(taintSourcesOf({ tool: 'lookup', externalMcp: true })).toContain('external-mcp');
    expect(
      taintSourcesOf({
        tool: 'Read',
        path: '/work/project/file',
        workspaceRoots: ['/work/project'],
      }),
    ).toEqual([]);
  });
  it('marks persistent changes without blocking them', () => {
    expect(
      persistenceMarkers('systemctl start example.service; crontab -l; cat /etc/sudoers'),
    ).toEqual(['service', 'cron', 'sudoers']);
  });
});

describe('root launcher attribution', () => {
  it('derives Home work and its actual runtime from launcher headers', () => {
    expect(
      workFromHeaders(
        1,
        new Headers({
          'x-volition-agent-unit': 'volition-agent-home--a0-c12-abcdef012345.service',
          'x-volition-agent-runtime': 'codex',
        }),
      ),
    ).toEqual({ messageId: 12, runtime: 'codex' });
    expect(
      workFromHeaders(
        1,
        new Headers({ 'x-volition-message': '12', 'x-volition-agent-runtime': 'hermes' }),
      ),
    ).toEqual({ runId: null, messageId: 12, runtime: 'unknown' });
  });
  it('rejects a work header for another unit or another agent', () => {
    expect(() =>
      workFromHeaders(
        1,
        new Headers({
          'x-volition-agent-unit': 'volition-agent-home--a0-c12-abcdef012345.service',
          'x-volition-message': '13',
        }),
      ),
    ).toThrow(/differs/);
    expect(() =>
      workFromHeaders(
        1,
        new Headers({
          'x-volition-agent-unit': 'volition-agent-project--a9-c12-abcdef012345.service',
        }),
      ),
    ).toThrow(/launcher unit/);
  });
});
