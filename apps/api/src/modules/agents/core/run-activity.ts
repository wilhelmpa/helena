import { recordActivity, textSide } from '#modules/issues/activity';
import { publishDomainEvent } from '#shared/helena';

// The run a start or end is recorded for. The ids are optional for callers that only
// have the issue side; the domain event needs the run and the agent.
interface RunRef {
  id?: number;
  agentId?: number;
  projectId?: number | null;
  trigger?: string | null;
  issueId: number | null;
  agentUserId: string;
}

function runEvent(run: RunRef & { id: number; agentId: number }) {
  return {
    runId: run.id,
    agentId: run.agentId,
    issueId: run.issueId,
    projectId: run.projectId ?? null,
    trigger: run.trigger ?? null,
  };
}

// Records that an agent took a queued run of the issue. Only the first claim is
// logged: a re-claim after an expired lease is the same task handed out again.
export async function recordAgentRunStarted(run: RunRef & { attempts: number }): Promise<void> {
  if (run.attempts > 1) return;
  if (run.id != null && run.agentId != null) {
    await publishDomainEvent({
      type: 'helena.run.started',
      projectId: run.projectId ?? null,
      subject: `runs/${run.id}`,
      actor: `agent:${run.agentId}`,
      data: runEvent({ ...run, id: run.id, agentId: run.agentId }),
    });
  }
  if (run.issueId == null) return;
  await recordActivity(run.issueId, [{ action: 'agent_started' }], run.agentUserId);
}

// Records how the agent's run of the issue ended.
export async function recordAgentRunFinished(
  run: RunRef,
  status: 'success' | 'failed',
  error: string | null = null,
): Promise<void> {
  if (run.id != null && run.agentId != null) {
    const data = runEvent({ ...run, id: run.id, agentId: run.agentId });
    const common = {
      projectId: run.projectId ?? null,
      subject: `runs/${run.id}`,
      actor: `agent:${run.agentId}`,
    };
    if (status === 'success') {
      await publishDomainEvent({ ...common, type: 'helena.run.finished', data });
    } else {
      await publishDomainEvent({ ...common, type: 'helena.run.failed', data: { ...data, error } });
    }
  }
  if (run.issueId == null) return;
  await recordActivity(
    run.issueId,
    [{ action: 'agent_finished', subject: textSide(status) }],
    run.agentUserId,
  );
}
