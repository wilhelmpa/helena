import { recordActivity, textSide } from '#modules/issues/activity';

// Records that an agent took a queued run of the issue. Only the first claim is
// logged: a re-claim after an expired lease is the same task handed out again. The
// Autopilot level the run works at rides along as the entry's subject, for the task's badge.
export async function recordAgentRunStarted(run: {
  issueId: number | null;
  attempts: number;
  agentUserId: string;
  autopilotLevel?: number | null;
}): Promise<void> {
  if (run.issueId == null || run.attempts > 1) return;
  const level = run.autopilotLevel == null ? undefined : textSide(String(run.autopilotLevel));
  await recordActivity(
    run.issueId,
    [{ action: 'agent_started', ...(level && { subject: level }) }],
    run.agentUserId,
  );
}

// Records how the agent's run of the issue ended.
export async function recordAgentRunFinished(
  run: { issueId: number | null; agentUserId: string },
  status: 'success' | 'failed',
): Promise<void> {
  if (run.issueId == null) return;
  await recordActivity(
    run.issueId,
    [{ action: 'agent_finished', subject: textSide(status) }],
    run.agentUserId,
  );
}
