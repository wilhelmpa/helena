import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import type { DynamicToolUIPart } from 'ai';
import common from '../../../messages/de/common.json';
import { AgentToolCall } from './AgentToolGroup';
import { outcomeMetadata } from './toolOutcome';

const render = (tool: DynamicToolUIPart) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="de" messages={{ common }}>
      <AgentToolCall tool={tool} />
    </NextIntlClientProvider>,
  );

const base = { type: 'dynamic-tool', toolName: 'terminal', toolCallId: 't', input: {} } as const;

describe('a command that ended with an exit code (135)', () => {
  it('shows the failed command and its exit code', () => {
    const html = render({
      ...base,
      state: 'output-available',
      output: 'no match',
      resultProviderMetadata: outcomeMetadata('nonzero_with_output', 1),
    } as DynamicToolUIPart);
    assert.match(html, /Fehlgeschlagen mit Code 1/);
    assert.match(html, /Fehlgeschlagen/);
    assert.match(html, /text-status-danger/);
    assert.doesNotMatch(html, /text-status-success/);
  });

  it('keeps a real error red and a plain success green', () => {
    const failed = render({
      ...base,
      state: 'output-error',
      errorText: 'spawn failed',
      resultProviderMetadata: outcomeMetadata('error', null),
    } as DynamicToolUIPart);
    assert.match(failed, /Fehlgeschlagen/);
    assert.match(failed, /text-status-danger/);
    const done = render({ ...base, state: 'output-available', output: 'ok' } as DynamicToolUIPart);
    assert.match(done, /text-status-success/);
    assert.doesNotMatch(done, /Beendet mit Code/);
  });
});
