import assert from 'node:assert/strict';
import { it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import type { DynamicToolUIPart } from 'ai';
import common from '../../../messages/de/common.json';
import agentRuntime from '../../../messages/de/agentRuntime.json';
import { AgentToolCall } from './AgentToolGroup';
import { outcomeMetadata } from './toolOutcome';
import RunSteps from '@/features/agent-runtime/components/RunSteps';
import { toUIMessage } from '@/features/ai-chat/utils/chatMessages';

const render = (children: React.ReactNode) =>
  renderToStaticMarkup(
    <NextIntlClientProvider timeZone="UTC" locale="de" messages={{ common, agentRuntime }}>
      {children}
    </NextIntlClientProvider>,
  );
it('marks exit 7 red, includes its code and retains historical output', () => {
  const part = toUIMessage({
    id: '211',
    role: 'assistant',
    createdAt: '2026-10-02T00:00:00Z',
    parts: [
      {
        type: 'tool',
        toolCallId: 'shell',
        toolName: 'shell',
        result: 'partial',
        isError: false,
        outcome: 'nonzero_with_output',
        exitCode: 7,
      },
    ],
  }).parts[0] as DynamicToolUIPart;
  assert.equal(part.state, 'output-error');
  assert.equal(part.state === 'output-error' && part.errorText, 'partial');
  const html = render(<AgentToolCall tool={part} />);
  assert.match(html, /Fehlgeschlagen.*7/);
  assert.match(html, /text-status-danger/);
  assert.doesNotMatch(html, /text-status-success/);
});
it('marks a legacy successful part with exit 7 as an error', () => {
  const html = render(
    <AgentToolCall
      tool={{
        type: 'dynamic-tool',
        toolName: 'shell',
        toolCallId: 's',
        input: {},
        state: 'output-available',
        output: 'partial',
        resultProviderMetadata: outcomeMetadata('nonzero_with_output', 7),
      }}
    />,
  );
  assert.match(html, /Fehlgeschlagen.*7/);
  assert.match(html, /text-status-danger/);
});
it('marks a run step with exit 7 as failed and visibly includes its code', () => {
  const html = render(
    <RunSteps
      events={[
        { type: 'TOOL_CALL_START', toolCallId: 's', toolCallName: 'shell' },
        {
          type: 'TOOL_CALL_RESULT',
          toolCallId: 's',
          metadata: { isError: false, outcome: 'nonzero_with_output', exitCode: 7 },
        },
      ]}
    />,
  );
  assert.match(html, /data-state="failed"/);
  assert.match(html, /Fehlgeschlagen.*7/);
});
it('preserves an exit code even when an older result has no outcome', () => {
  const part = toUIMessage({
    id: '211-old',
    role: 'assistant',
    createdAt: '2026-10-02T00:00:00Z',
    parts: [{ type: 'tool', toolCallId: 's', toolName: 'shell', result: 'partial', exitCode: 7 }],
  }).parts[0] as DynamicToolUIPart;
  assert.equal(part.state, 'output-error');
  assert.match(render(<AgentToolCall tool={part} />), /Fehlgeschlagen.*7/);
});
