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

// 122B: a shell command that exits with 7 showed "Fertig" with a green check. It ends
// neutrally with its code: neither done nor failed.
const render = (children: React.ReactNode) =>
  renderToStaticMarkup(
    <NextIntlClientProvider timeZone="UTC" locale="de" messages={{ common, agentRuntime }}>
      {children}
    </NextIntlClientProvider>,
  );
const neutral = (html: string) => {
  assert.match(html, /Beendet mit Code 7/);
  assert.doesNotMatch(html, /Fertig/);
  assert.doesNotMatch(html, /Fehlgeschlagen/);
  assert.doesNotMatch(html, /text-status-success/);
  assert.doesNotMatch(html, /text-status-danger/);
};
it('shows exit 7 neutrally with its code and keeps its output', () => {
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
  assert.equal(part.state, 'output-available');
  assert.equal(part.state === 'output-available' && part.output, 'partial');
  neutral(render(<AgentToolCall tool={part} />));
});
it('shows exit 7 neutrally when an older runner marked it as an error', () => {
  const part = toUIMessage({
    id: '211-flag',
    role: 'assistant',
    createdAt: '2026-10-02T00:00:00Z',
    parts: [
      {
        type: 'tool',
        toolCallId: 's',
        toolName: 'shell',
        result: 'partial',
        isError: true,
        outcome: 'nonzero_with_output',
        exitCode: 7,
      },
    ],
  }).parts[0] as DynamicToolUIPart;
  neutral(render(<AgentToolCall tool={part} />));
});
it('shows exit 7 neutrally when the result has only its exit code', () => {
  const part = toUIMessage({
    id: '211-old',
    role: 'assistant',
    createdAt: '2026-10-02T00:00:00Z',
    parts: [{ type: 'tool', toolCallId: 's', toolName: 'shell', result: 'partial', exitCode: 7 }],
  }).parts[0] as DynamicToolUIPart;
  assert.equal(part.state, 'output-available');
  neutral(render(<AgentToolCall tool={part} />));
});
it('keeps a streamed part with exit 7 neutral', () => {
  neutral(
    render(
      <AgentToolCall
        tool={{
          type: 'dynamic-tool',
          toolName: 'shell',
          toolCallId: 's',
          input: {},
          state: 'output-available',
          output: 'partial',
          resultProviderMetadata: outcomeMetadata(undefined, 7),
        }}
      />,
    ),
  );
});
it('still shows a real tool error as failed', () => {
  const html = render(
    <AgentToolCall
      tool={{
        type: 'dynamic-tool',
        toolName: 'shell',
        toolCallId: 's',
        input: {},
        state: 'output-error',
        errorText: 'spawn failed',
        resultProviderMetadata: outcomeMetadata('error', null),
      }}
    />,
  );
  assert.match(html, /Fehlgeschlagen/);
  assert.match(html, /text-status-danger/);
});
it('shows a run step with exit 7 as ended with its code, not done or failed', () => {
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
  assert.match(html, /data-state="exited"/);
  assert.match(html, /Beendet mit Code 7/);
  assert.doesNotMatch(html, /Fertig|Fehlgeschlagen/);
});
