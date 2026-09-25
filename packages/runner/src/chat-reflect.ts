import type { ChatReflectionClaim, Client, ReflectionReport } from './client';
import type { RunnerConfig } from './config';
import { reflectTurn } from './reflect';
import type { RuntimeAdapter } from './runtime';

// A reflection on a chat (docs/helena-decisions/agent-context.md §5): the chat's session
// continued with Helena's prompt and only the memory and skill tools, like a run's
// reflection, then reported. Helena hands it out only while no answer of the chat runs, and
// holds the chat's next answer until it is reported, so the two never share the session.
// What the agent writes to its memory waits for the owner as always.
export async function reflectOnChat(
  config: RunnerConfig,
  client: Client,
  claim: ChatReflectionClaim,
  runtime: RuntimeAdapter | null,
): Promise<ReflectionReport> {
  let report: ReflectionReport;
  try {
    const settings = (await runtime?.runSettings()) ?? null;
    report = await reflectTurn(config, {
      sessionId: claim.sessionId,
      request: claim,
      hermes: settings ?? { toolsets: null, env: {} },
      model: claim.model,
      thinkingLevel: claim.thinkingLevel,
      cwd: config.cwd,
      env: {
        ITSAPLAN_TRIGGER: 'chat',
        ITSAPLAN_RUN_ID: '',
        ITSAPLAN_THREAD_ID: claim.threadId,
        ITSAPLAN_MESSAGE_ID: String(claim.messageId),
        ITSAPLAN_SESSION_ID: claim.sessionId,
      },
      work: { kind: 'chat', id: claim.messageId },
    });
  } catch (err) {
    report = {
      status: 'failed',
      saved: [],
      error: (err instanceof Error ? err.message : String(err)).slice(0, 500),
    };
  }
  await client.reportChatReflection(claim.id, claim.claim, report);
  return report;
}
