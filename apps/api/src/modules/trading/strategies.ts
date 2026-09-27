import { and, desc, eq, sql } from 'drizzle-orm';
import { approvalRequest, db, integrationCredential, projectMember } from '@repo/db';
import { readVaultFile, splitNote } from '@repo/vault';
import { AlpacaPaperClient, normalizedSymbol, readKeys } from '@helena/trading';
import type { ProjectRef, ToolCallContext } from '@helena/sdk';
import { createApprovalRequest } from '#modules/approvals/service';
import { isAgentUser } from '#modules/agents/core/service';
import { credentialValues } from '#modules/agents/integrations/service';
import { listAgentToolLinks } from '#modules/agents/tools/service';
import { HttpError } from '#shared/lib';

interface StrategyVersion {
  strategyId: string;
  strategyVersion: string;
}

export async function strategySnapshot(project: ProjectRef, strategy: StrategyVersion) {
  if (
    !project.key ||
    !/^[A-Z0-9_-]+$/i.test(project.key) ||
    !/^[a-z0-9][a-z0-9-]{1,39}$/.test(strategy.strategyId) ||
    !/^\d{1,3}(\.\d{1,3}){0,2}$/.test(strategy.strategyVersion)
  )
    throw new HttpError(400, 'Invalid strategy identity.');
  const { strategyId, strategyVersion } = strategy;
  const path = `Projects/${project.key}/Docs/Strategien/${strategyId}/${strategyId} v${strategyVersion}.md`;
  // The complete text goes on the existing human approval card; never approve an excerpt.
  const file = await readVaultFile(path, 6000);
  if (file.bytes.length > 6000) throw new HttpError(413, 'The strategy snapshot is too large.');
  const content = file.bytes.toString('utf8');
  const { frontmatter: meta } = splitNote(content);
  if (
    meta.typ !== 'strategie' ||
    meta.strategie !== strategyId ||
    String(meta.version) !== strategyVersion ||
    meta.status !== 'paper' ||
    !Array.isArray(meta.instrumente) ||
    !meta.instrumente.length ||
    meta.instrumente.some((symbol) => typeof symbol !== 'string' || !symbol.trim()) ||
    typeof meta.backtest !== 'string' ||
    !meta.backtest.trim()
  )
    throw new HttpError(
      409,
      'The canonical strategy needs matching identity/version, status paper, instruments and a backtest reference.',
    );
  return {
    path,
    sha256: file.sha256,
    content,
    symbols: meta.instrumente.map((symbol) => normalizedSymbol(String(symbol))),
  };
}

export async function requestStrategyApproval(input: {
  project: ProjectRef;
  agent: { id: number; userId: string };
  credentialId: number;
  strategyId: string;
  strategyVersion: string;
  issueId?: number;
}) {
  if (!input.project.teamId) throw new HttpError(403, 'Paper trading needs a team.');
  const links = await listAgentToolLinks(input.agent.id);
  if (
    !links.some(
      (link) => link.credentialId === input.credentialId && link.integrationKey === 'alpaca_paper',
    )
  )
    throw new HttpError(403, 'This agent has no tool bound to that paper credential.');
  const [credential] = await db
    .select({ projectId: integrationCredential.projectId })
    .from(integrationCredential)
    .where(
      and(
        eq(integrationCredential.id, input.credentialId),
        eq(integrationCredential.teamId, input.project.teamId),
        eq(integrationCredential.integrationKey, 'alpaca_paper'),
      ),
    );
  if (!credential || (credential.projectId !== null && credential.projectId !== input.project.id))
    throw new HttpError(403, 'This paper credential is not available in this project.');
  const values = await credentialValues(input.credentialId, input.project.teamId);
  if (!values) throw new HttpError(403, 'The paper credential is no longer available.');
  const account = await new AlpacaPaperClient(readKeys(values)).account();
  if (!/^[0-9a-f-]{36}$/i.test(account.id))
    throw new HttpError(502, 'No valid paper account identity.');
  return createStrategyApproval(input, account.id);
}

// Only a broker-verified account id reaches this internal helper; the route has no payload field.
export async function createStrategyApproval(
  input: {
    project: ProjectRef;
    agent: { id: number; userId: string };
    strategyId: string;
    strategyVersion: string;
    issueId?: number;
  },
  accountId: string,
) {
  const note = await strategySnapshot(input.project, input);
  const { strategyId, strategyVersion } = input;
  return createApprovalRequest({
    projectId: input.project.id,
    agent: input.agent,
    issueId: input.issueId,
    kind: 'other',
    action: `Paper-Strategie freigeben: ${strategyId} v${strategyVersion} | ${accountId} | ${note.sha256}`,
    details: `Nur Paper-Trading, kein Echtgeld. Diese Freigabe gilt für den vollständigen Inhalt unten und das Paper-Konto ${accountId}. Änderungen brauchen eine neue Freigabe. Risikolimits gelten zusätzlich.\n\n${note.path}\nSHA-256: ${note.sha256}\n\n${note.content}`,
    payload: {
      type: 'trading-strategy',
      accountId,
      strategyId,
      strategyVersion,
      path: note.path,
      sha256: note.sha256,
    },
  });
}

export async function assertStrategyApproval(
  ctx: ToolCallContext,
  accountId: string,
  strategy: StrategyVersion & { symbol: string },
) {
  if (!ctx.project) throw new HttpError(403, 'Paper trading needs a project.');
  const note = await strategySnapshot(ctx.project, strategy);
  if (!note.symbols.includes(normalizedSymbol(strategy.symbol)))
    throw new HttpError(403, 'This symbol is not in the approved strategy.');
  const [approval] = await db
    .select({
      status: approvalRequest.status,
      payload: approvalRequest.payload,
      decidedBy: approvalRequest.decidedByUserId,
    })
    .from(approvalRequest)
    .where(
      and(
        eq(approvalRequest.projectId, ctx.project.id),
        sql`${approvalRequest.payload}->>'type' = 'trading-strategy'`,
        sql`${approvalRequest.payload}->>'accountId' = ${accountId}`,
        sql`${approvalRequest.payload}->>'strategyId' = ${strategy.strategyId}`,
        sql`${approvalRequest.payload}->>'strategyVersion' = ${strategy.strategyVersion}`,
      ),
    )
    .orderBy(desc(approvalRequest.id))
    .limit(1);
  const payload = approval?.payload as Record<string, unknown> | null | undefined;
  const [owner] = approval?.decidedBy
    ? await db
        .select({ role: projectMember.role })
        .from(projectMember)
        .where(
          and(
            eq(projectMember.projectId, ctx.project.id),
            eq(projectMember.userId, approval.decidedBy),
          ),
        )
    : [];
  if (
    approval?.status !== 'approved' ||
    !approval.decidedBy ||
    owner?.role !== 'owner' ||
    payload?.sha256 !== note.sha256 ||
    payload?.path !== note.path ||
    (await isAgentUser(approval.decidedBy))
  )
    throw new HttpError(
      403,
      'The current strategy snapshot has no human paper approval. Request trading_request_strategy_approval; agents cannot approve it themselves.',
    );
}
