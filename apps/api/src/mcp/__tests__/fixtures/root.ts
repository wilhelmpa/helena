import { expect } from 'bun:test';
import { agentChatMessage, db } from '@repo/db';
import { eq } from 'drizzle-orm';
import { app, apiKeyApi, authedApi } from '#tests/helpers/app';
import { useHostdTransport } from '#modules/server/hostd';
import { bootstrapHomeAgent } from '../../../scripts/bootstrap-home-agent';
import type { McpRouteTool } from '../../generate';
import { dispatchTool } from '../../dispatch';
import type { seedToolStack } from './stack';

export async function rootFixture(
  stack: Awaited<ReturnType<typeof seedToolStack>>,
  tool: McpRouteTool,
  args: Record<string, unknown>,
) {
  const home = await bootstrapHomeAgent();
  if (home.status !== 'ready') throw new Error('Missing ABSCHLUSSTEST Home agent');
  const api = authedApi(stack.owner.cookie);
  const sent = await api
    .teams({ teamId: stack.project.teamId })
    ['ai-agents']({ agentId: home.agentId })
    .chat.post({ prompt: 'ABSCHLUSSTEST mocked root work' });
  expect(sent.status).toBe(200);
  const claimed = await apiKeyApi(home.apiKey)['agent-chats'].claim.post();
  expect(claimed.data?.message?.id).toBe(sent.data!.messageId);
  await db
    .update(agentChatMessage)
    .set({ observedRuntime: 'helena' })
    .where(eq(agentChatMessage.id, sent.data!.messageId));
  let executions = 0;
  useHostdTransport(async (method) => {
    if (method === 'RootSettings')
      return { enabled: true, directOnly: true, unrestricted: true, epoch: 0 };
    if (method === 'RunPrivileged') {
      executions++;
      return {
        unit: 'volition-ABSCHLUSSTEST-root.service',
        exitCode: 0,
        output: 'ABSCHLUSSTEST\n',
      };
    }
    throw new Error(`No ABSCHLUSSTEST Hostd fixture for ${method}`);
  });
  try {
    const response = await dispatchTool(
      app,
      tool,
      args,
      { kind: 'api-key', apiKey: home.apiKey },
      { viaMcpEndpoint: true, messageId: sent.data!.messageId },
    );
    expect(response.structuredContent).toMatchObject({
      ok: true,
      status: 200,
      data: { status: 'success', approvalId: null },
    });
    expect(executions).toBe(1);
    const foreign = await dispatchTool(
      app,
      tool,
      args,
      { kind: 'api-key', apiKey: stack.agentKey },
      { viaMcpEndpoint: true, messageId: sent.data!.messageId },
    );
    expect(foreign.structuredContent).toMatchObject({ ok: false, status: 403 });
    expect(executions).toBe(1);
    return { response, foreign };
  } finally {
    useHostdTransport(null);
  }
}
