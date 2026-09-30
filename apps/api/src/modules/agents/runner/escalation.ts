import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import { agentRun, aiAgent, db, getSetting, projectMember } from '@repo/db';
import { parseLocalModelId } from '@helena/sdk';
import { DEFAULT_ESCALATION, escalate } from '#modules/escalation/rules';
import {
  loadModelAvailability,
  runtimeOfPolicy,
  type ModelAvailabilityIndex,
} from '#modules/model-availability/service';
import { createComment } from '#modules/issues/activity';
import { sameModel, type ModelCheck } from '../runtime-sync/model-check';
import {
  normalizeAgentEscalation,
  normalizeRuntimePolicy,
  type AgentEscalationPolicy,
} from '../core/service';

export interface EscalationReport {
  target: string;
  reason: string;
  detail: string | null;
  handover: string;
}

export interface DelegationResult {
  status: 'success';
  touchedFiles: string[];
  finalMessage: string;
  version: '1';
  durationMs: number;
  diff: string;
}

export function failureKind(error: string | null) {
  if (/test(?:s)? (?:failed|failing)|(?:failed|failing) test/i.test(error ?? ''))
    return 'tests-failed' as const;
  if (/\b(loop|repeated|stuck|resume limit)\b/i.test(error ?? '')) return 'loop' as const;
  if (/\b(timeout|timed out|time limit|deadline)\b/i.test(error ?? '')) return 'timeout' as const;
  return 'error' as const;
}

function escalationDestination(
  policy: AgentEscalationPolicy,
  runtime: string,
  availability?: ModelAvailabilityIndex,
) {
  const target = policy.target ?? (runtime === 'claude' ? 'claude' : 'codex');
  const model =
    policy.model ??
    (target === 'claude'
      ? 'claude-opus-5-5'
      : availability?.refusal('codex', 'gpt-6.1-sol')
        ? 'gpt-6-sol'
        : 'gpt-6.1-sol');
  return { target, model };
}

export function failureDecision(
  policy: AgentEscalationPolicy,
  run: {
    trigger: string;
    continuedFromRunId: number | null;
    agentId: number;
    projectId: number;
    issueId: number | null;
    attempts: number;
    error: string | null;
    failures: number;
    runtime: string;
    model: string | null;
    configuredModel: string | null;
    modelSource: string | null;
  },
  availability?: ModelAvailabilityIndex,
) {
  if (policy.maxDepth === 0 || run.trigger === 'escalation' || run.continuedFromRunId != null)
    return null;
  const resumeLimit = /resume limit/i.test(run.error ?? '');
  if (resumeLimit ? !policy.onResumeLimit : policy.afterFailures === 0) return null;
  if (!['claude', 'codex', 'helena'].includes(run.runtime) && !policy.target && !policy.model)
    return null;
  const destination = escalationDestination(policy, run.runtime, availability);
  if (run.model && sameModel(destination.model, run.model)) return null;
  if (
    run.configuredModel &&
    run.modelSource !== 'local' &&
    run.modelSource !== 'default' &&
    !parseLocalModelId(run.configuredModel)
  )
    return null;
  const kind = failureKind(run.error);
  const count = Math.max(run.attempts, run.failures);
  const decision = escalate(
    {
      ...DEFAULT_ESCALATION,
      enabled: true,
      defaultModel: destination.model,
      failure: {
        enabled: true,
        on: [kind],
        localAttempts: resumeLimit ? 0 : policy.afterFailures,
        model: policy.model,
      },
    },
    {
      agentId: run.agentId,
      projectId: run.projectId,
      taskId: run.issueId,
      failure: kind,
      localAttempts: count,
    },
  );
  return decision.model
    ? { model: decision.model, reason: resumeLimit ? 'resume-limit' : 'failed-attempts', count }
    : null;
}

export async function escalationPolicy(agentId: number): Promise<AgentEscalationPolicy> {
  const [agent] = await db
    .select({ teamId: aiAgent.teamId, runtimePolicy: aiAgent.runtimePolicy })
    .from(aiAgent)
    .where(eq(aiAgent.id, agentId));
  if (!agent) return normalizeAgentEscalation(null);
  const teamDefault = await getSetting(`volition.team.${agent.teamId}.escalation`);
  const team =
    teamDefault && typeof teamDefault === 'object' ? (teamDefault as Record<string, unknown>) : {};
  const own = (agent.runtimePolicy as { escalation?: unknown } | null)?.escalation;
  const override = own && typeof own === 'object' ? (own as Record<string, unknown>) : {};
  return normalizeAgentEscalation({
    ...team,
    ...override,
    ...(override.target && override.target !== team.target && override.model === undefined
      ? { model: null }
      : {}),
  });
}

async function targetAgent(fromAgentId: number, projectId: number, runtime: 'claude' | 'codex') {
  const candidates = await db
    .select({ id: aiAgent.id, runtimePolicy: aiAgent.runtimePolicy })
    .from(aiAgent)
    .innerJoin(projectMember, eq(projectMember.userId, aiAgent.userId))
    .where(
      and(
        eq(projectMember.projectId, projectId),
        ne(aiAgent.id, fromAgentId),
        eq(aiAgent.template, false),
        isNull(aiAgent.pausedAt),
      ),
    )
    .orderBy(aiAgent.id);
  return (
    candidates.find(
      (candidate) => normalizeRuntimePolicy(candidate.runtimePolicy).runtime === runtime,
    )?.id ?? null
  );
}

async function failOrigin(
  runId: number,
  issueId: number | null,
  actorUserId: string,
  reason: string,
) {
  await db
    .update(agentRun)
    .set({ status: 'failed', lastError: reason })
    .where(eq(agentRun.id, runId));
  if (issueId != null)
    await createComment({
      issueId,
      actorUserId,
      body: `Eskalation fehlgeschlagen (Lauf #${runId}): ${reason}. Die Kosten stehen im Laufprotokoll.`,
    });
}

export function delegationBrief(input: {
  runId: number;
  prompt: string;
  output: string | null;
  error: string | null;
  history: { prompt: string; output: string | null; error: string | null }[];
  reason: string;
  handover: string;
}) {
  const history = input.history
    .map(
      (run, index) =>
        `${index + 1}. Aufgabe: ${run.prompt.slice(0, 1500)}\nErgebnis: ${(run.output ?? '').slice(0, 1500)}\nFehler: ${run.error ?? 'keiner'}`,
    )
    .join('\n\n');
  return [
    `Delegation aus Lauf #${input.runId}. Grund: ${input.reason}.`,
    'Arbeite im bereitgestellten Git-Worktree. Implementiere die Aufgabe; erstelle keinen Commit.',
    'Der Diff und ein kurzer Ergebnisbericht sind dein Ergebnis. Nenne geänderte Dateien, Tests und offene Punkte.',
    'Prüfe die Projektanweisungen und führe die dort genannten gezielten Tests aus.',
    `Aufgabe:\n${input.prompt}`,
    `Übergabe:\n${input.handover}`,
    `Bisheriger Verlauf (gekürzt):\n${history || 'kein früherer Lauf'}`,
    `Letztes Ergebnis: ${(input.output ?? '').slice(0, 3000)}`,
    `Letzter Fehler: ${input.error ?? 'keiner'}`,
  ].join('\n\n');
}

export function reviewBrief(originId: number, delegatedId: number, result: DelegationResult) {
  return [
    `Prüfe das delegierte Ergebnis aus Lauf #${delegatedId} für deinen Lauf #${originId}.`,
    'Wende den Diff im Projekt-Workspace an. Prüfe zuerst geänderte bestehende Tests auf abgeschwächte Assertions und Skips.',
    'Vergleiche den Diff mit der Aufgabe. Prüfe hartcodierte Erfolge, Catch-all-Defaults, erfundene APIs, toten Code, doppelte Umsetzung, Tests auf Interna und spekulative Optionen.',
    'Führe die echten Projekt-Gates selbst neu aus. Übernimm und committe erst, wenn alle Prüfungen bestanden sind.',
    'Falls etwas nicht passt, melde den genauen Befund als Delta-Briefing und committe nicht.',
    'Antworte am Ende mit JSON: {"status":"accepted"|"rejected","changedTestsChecked":true|false,"gates":[{"command":"...","passed":true|false}],"commit":"Commit-SHA oder null","message":"..."}.',
    `Bericht des Implementierers (Version ${result.version}, ${result.durationMs} ms): ${result.finalMessage}`,
    `Geänderte Dateien: ${result.touchedFiles.join(', ')}`,
    `Diff:\n${result.diff}`,
  ].join('\n\n');
}

export function reviewAccepted(output: string | null): { commit: string; message: string } | null {
  try {
    const value = JSON.parse(output ?? '') as Record<string, unknown>;
    if (
      value.status !== 'accepted' ||
      value.changedTestsChecked !== true ||
      !Array.isArray(value.gates) ||
      value.gates.length === 0 ||
      !value.gates.every(
        (gate) =>
          gate &&
          typeof gate.command === 'string' &&
          gate.command.trim().length > 0 &&
          gate.passed === true,
      ) ||
      typeof value.commit !== 'string' ||
      !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(value.commit)
    )
      return null;
    return {
      commit: value.commit,
      message: typeof value.message === 'string' ? value.message.slice(0, 2_000) : '',
    };
  } catch {
    return null;
  }
}

export function weakenedTests(diff: string): string[] {
  let file = '';
  const changes = new Map<string, { removed: number; added: number; skipped: boolean }>();
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      file = /^diff --git a\/.* b\/(.*)$/.exec(line)?.[1] ?? '';
      continue;
    }
    if (!/(?:^|\/)(__tests__\/|[^/]+\.(?:test|spec)\.)/.test(file)) continue;
    const change = changes.get(file) ?? { removed: 0, added: 0, skipped: false };
    if (line.startsWith('-') && !line.startsWith('---') && /\b(?:expect|assert)\s*\(/.test(line))
      change.removed++;
    if (line.startsWith('+') && !line.startsWith('+++')) {
      if (/\b(?:expect|assert)\s*\(/.test(line)) change.added++;
      if (/\b(?:test|it|describe)\.(?:skip|todo|only)\s*\(/.test(line)) change.skipped = true;
    }
    changes.set(file, change);
  }
  return [...changes]
    .filter(([, change]) => change.skipped || change.removed > change.added)
    .map(([path]) => path);
}

export async function queueEscalation(
  agentId: number,
  run: { id: number; projectId: number; issueId: number | null },
  report: EscalationReport,
): Promise<{ runId: number | null; error: string | null }> {
  const policy = await escalationPolicy(agentId);
  if (
    policy.maxDepth === 0 ||
    (!['failed-attempts', 'resume-limit'].includes(report.reason) && !policy.onRequest)
  )
    return { runId: null, error: null };
  const [source] = await db
    .select({
      id: agentRun.id,
      trigger: agentRun.trigger,
      continuedFromRunId: agentRun.continuedFromRunId,
      prompt: agentRun.prompt,
      output: agentRun.output,
      lastError: agentRun.lastError,
      actorUserId: aiAgent.userId,
      runtimePolicy: aiAgent.runtimePolicy,
    })
    .from(agentRun)
    .innerJoin(aiAgent, eq(aiAgent.id, agentRun.agentId))
    .where(eq(agentRun.id, run.id));
  if (!source || source.trigger === 'escalation' || source.continuedFromRunId != null)
    return { runId: null, error: null };
  const destination = escalationDestination(
    policy,
    runtimeOfPolicy(source.runtimePolicy),
    await loadModelAvailability(),
  );
  const target = await targetAgent(agentId, run.projectId, destination.target);
  if (!target) {
    const error = `Kein ${destination.target}-Agent im Projekt verfügbar.`;
    await failOrigin(run.id, run.issueId, source.actorUserId, error);
    return { runId: null, error };
  }
  const history =
    run.issueId == null
      ? []
      : await db
          .select({
            prompt: agentRun.prompt,
            output: agentRun.output,
            error: agentRun.lastError,
          })
          .from(agentRun)
          .where(
            and(
              eq(agentRun.agentId, agentId),
              eq(agentRun.issueId, run.issueId),
              ne(agentRun.id, run.id),
            ),
          )
          .orderBy(desc(agentRun.id))
          .limit(4);
  const prompt = delegationBrief({
    runId: run.id,
    prompt: source.prompt,
    output: source.output,
    error: source.lastError,
    history,
    reason: `${report.reason}${report.detail ? `: ${report.detail}` : ''}`,
    handover: report.handover,
  });
  const runId = await db.transaction(async (tx) => {
    await tx
      .select({ id: agentRun.id })
      .from(agentRun)
      .where(eq(agentRun.id, run.id))
      .for('update');
    const [existing] = await tx
      .select({ id: agentRun.id })
      .from(agentRun)
      .where(and(eq(agentRun.continuedFromRunId, run.id), eq(agentRun.trigger, 'escalation')))
      .limit(1);
    if (existing) return existing.id;
    const [queued] = await tx
      .insert(agentRun)
      .values({
        agentId: target,
        projectId: run.projectId,
        issueId: run.issueId,
        trigger: 'escalation',
        sourceActivityId: null,
        prompt,
        model: destination.model,
        continuedFromRunId: run.id,
      })
      .returning({ id: agentRun.id });
    return queued!.id;
  });
  return { runId, error: null };
}

export async function queueFailedRunEscalation(runId: number): Promise<void> {
  const [run] = await db
    .select({
      agentId: agentRun.agentId,
      projectId: agentRun.projectId,
      issueId: agentRun.issueId,
      lastError: agentRun.lastError,
      attempts: agentRun.attempts,
      trigger: agentRun.trigger,
      continuedFromRunId: agentRun.continuedFromRunId,
      model: agentRun.model,
      modelCheck: agentRun.modelCheck,
      agentModel: aiAgent.model,
      runtimePolicy: aiAgent.runtimePolicy,
    })
    .from(agentRun)
    .innerJoin(aiAgent, eq(aiAgent.id, agentRun.agentId))
    .where(and(eq(agentRun.id, runId), eq(agentRun.status, 'failed')));
  if (!run) return;
  const policy = await escalationPolicy(run.agentId);
  const recent =
    run.issueId == null
      ? []
      : await db
          .select({ status: agentRun.status })
          .from(agentRun)
          .where(
            and(
              eq(agentRun.agentId, run.agentId),
              eq(agentRun.issueId, run.issueId),
              isNull(agentRun.continuedFromRunId),
            ),
          )
          .orderBy(desc(agentRun.id))
          .limit(5);
  const failures = recent.length ? recent.findIndex((item) => item.status !== 'failed') : -1;
  const check = run.modelCheck as ModelCheck | null;
  const runtime = runtimeOfPolicy(run.runtimePolicy);
  const decision = failureDecision(
    policy,
    {
      trigger: run.trigger,
      continuedFromRunId: run.continuedFromRunId,
      agentId: run.agentId,
      projectId: run.projectId,
      issueId: run.issueId,
      attempts: run.attempts,
      error: run.lastError,
      failures: failures < 0 ? recent.length : failures,
      runtime,
      model: check?.used?.model ?? check?.configured.model ?? run.model ?? run.agentModel,
      configuredModel: run.model ?? check?.configured.model ?? run.agentModel,
      modelSource:
        run.model && !parseLocalModelId(run.model)
          ? 'run'
          : check?.configured.source === 'local'
            ? 'local'
            : run.agentModel && !parseLocalModelId(run.agentModel)
              ? 'agent'
              : (check?.configured.source ?? null),
    },
    await loadModelAvailability(),
  );
  if (!decision) return;
  await queueEscalation(
    run.agentId,
    { id: runId, projectId: run.projectId, issueId: run.issueId },
    {
      target: `runtime:${policy.target ?? (runtime === 'claude' ? 'claude' : 'codex')}/${decision.model}`,
      reason: decision.reason,
      detail: `${decision.count} Fehlversuche; ${run.lastError ?? 'kein Fehlertext'}`.slice(0, 200),
      handover: 'Setze die Aufgabe nach dem fehlgeschlagenen lokalen Lauf fort.',
    },
  );
}

export async function completeDelegation(
  runId: number,
  status: 'success' | 'failed',
  output: string | null,
  error: string | null,
  result: DelegationResult | undefined,
): Promise<{ status: 'success' | 'failed'; error: string | null } | null> {
  const [run] = await db
    .select({
      agentId: agentRun.agentId,
      projectId: agentRun.projectId,
      issueId: agentRun.issueId,
      trigger: agentRun.trigger,
      parentId: agentRun.continuedFromRunId,
      actorUserId: aiAgent.userId,
    })
    .from(agentRun)
    .innerJoin(aiAgent, eq(aiAgent.id, agentRun.agentId))
    .where(eq(agentRun.id, runId));
  if (!run?.parentId) return null;
  const [parent] = await db
    .select({
      agentId: agentRun.agentId,
      trigger: agentRun.trigger,
      originId: agentRun.continuedFromRunId,
      actorUserId: aiAgent.userId,
    })
    .from(agentRun)
    .innerJoin(aiAgent, eq(aiAgent.id, agentRun.agentId))
    .where(eq(agentRun.id, run.parentId));
  if (!parent) return null;
  if (run.trigger === 'escalation') {
    const reason =
      status === 'failed'
        ? (error ?? 'Eskalationslauf fehlgeschlagen')
        : !result
          ? 'Eskalationslauf lieferte keinen prüfbaren Diff'
          : weakenedTests(result.diff).length > 0
            ? `Geänderte Tests schwächen Assertions ab oder überspringen Tests: ${weakenedTests(result.diff).join(', ')}`
            : null;
    if (reason) {
      await db
        .update(agentRun)
        .set({ status: 'failed', lastError: reason })
        .where(eq(agentRun.id, runId));
      await failOrigin(run.parentId, run.issueId, parent.actorUserId, reason);
      return { status: 'failed', error: reason };
    }
    const files = result!.touchedFiles;
    const [review] = await db
      .insert(agentRun)
      .values({
        agentId: parent.agentId,
        projectId: run.projectId,
        issueId: run.issueId,
        trigger: 'manual',
        sourceActivityId: null,
        prompt: reviewBrief(run.parentId, runId, result!),
        continuedFromRunId: runId,
      })
      .returning({ id: agentRun.id });
    if (run.issueId != null)
      await createComment({
        issueId: run.issueId,
        actorUserId: run.actorUserId,
        body: `Eskalation #${runId} hat einen Diff und Ergebnisbericht für Lauf #${run.parentId} zurückgegeben (${files.slice(0, 20).join(', ').slice(0, 1200)}${files.length > 20 ? ', …' : ''}). Prüflauf #${review!.id} übernimmt nach eigenen Gates; Kosten und Grund stehen im Laufprotokoll.`,
      });
    return { status: 'success', error: null };
  }
  if (parent.trigger !== 'escalation' || parent.originId == null) return null;
  const accepted = status === 'success' ? reviewAccepted(output) : null;
  if (!accepted) {
    const reason =
      error ?? 'Prüfung/Übernahme fehlgeschlagen; Gates, Testprüfung und Commit prüfen.';
    await db
      .update(agentRun)
      .set({ status: 'failed', lastError: reason })
      .where(eq(agentRun.id, runId));
    await failOrigin(parent.originId, run.issueId, run.actorUserId, reason);
    return { status: 'failed', error: reason };
  }
  await db
    .update(agentRun)
    .set({
      status: 'success',
      lastError: null,
      output: sql`left(coalesce(${agentRun.output}, '') || ${`\n\nEskalation #${run.parentId} geprüft und übernommen: ${accepted.commit}. ${accepted.message}`}, 131072)`,
    })
    .where(eq(agentRun.id, parent.originId));
  if (run.issueId != null)
    await createComment({
      issueId: run.issueId,
      actorUserId: run.actorUserId,
      body: `Eskalation geprüft und übernommen. Commit: ${accepted.commit}. ${accepted.message} Kosten und Grund stehen in den Läufen #${parent.originId}, #${run.parentId} und #${runId}.`,
    });
  return { status: 'success', error: null };
}
