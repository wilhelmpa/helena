import { and, eq, ne, or, gte, sql } from 'drizzle-orm';
import { db, helenaPaperOrderIntent, integrationCredential } from '@repo/db';
import {
  terminalOrder,
  type AlpacaOrder,
  type PaperExecution,
  type PaperIntent,
} from '@helena/trading';
import { credentialValues } from '#modules/agents/integrations/service';
import { emergencyStopActive } from '#modules/emergency-stop/service';
import { HttpError } from '#shared/lib';
import { assertStrategyApproval } from './strategies';

let activeLocks = 0;
const columns = {
  accountId: helenaPaperOrderIntent.accountId,
  clientOrderId: helenaPaperOrderIntent.clientOrderId,
  requestHash: helenaPaperOrderIntent.requestHash,
  order: helenaPaperOrderIntent.brokerOrder,
};
const at = (accountId: string, clientOrderId: string) =>
  and(
    eq(helenaPaperOrderIntent.accountId, accountId),
    eq(helenaPaperOrderIntent.clientOrderId, clientOrderId),
  );

export const paperExecution: PaperExecution = {
  async withAccountLock(ctx, accountId, work) {
    if (!ctx.project?.teamId || !ctx.credentialId)
      throw new HttpError(403, 'A project-bound paper credential is required.');
    const teamId = ctx.project.teamId;
    // Intent writes commit on another pool connection before HTTP; leave pool capacity for them.
    if (activeLocks >= 3)
      throw new HttpError(409, 'Paper execution is busy; retry this requestId later.');
    activeLocks += 1;
    try {
      return await db.transaction(async (tx) => {
        const [lock] = await tx.execute<{ acquired: boolean }>(
          sql`select pg_try_advisory_xact_lock(hashtextextended(${`helena-paper:${accountId}`}, 0)) as acquired`,
        );
        if (!lock?.acquired)
          throw new HttpError(
            409,
            'Another paper operation is using this account; retry this requestId later.',
          );
        const [credential] = await tx
          .select({ id: integrationCredential.id, projectId: integrationCredential.projectId })
          .from(integrationCredential)
          .where(
            and(
              eq(integrationCredential.id, ctx.credentialId!),
              eq(integrationCredential.teamId, teamId),
              eq(integrationCredential.integrationKey, 'alpaca_paper'),
            ),
          )
          .for('share');
        if (
          !credential ||
          (credential.projectId !== null && credential.projectId !== ctx.project!.id)
        )
          throw new HttpError(403, 'The paper credential is no longer available in this team.');
        const fresh = await credentialValues(credential.id, teamId);
        if (!fresh) throw new HttpError(403, 'The paper credential is no longer available.');
        if (fresh.keyId !== ctx.credential?.keyId || fresh.secretKey !== ctx.credential?.secretKey)
          throw new HttpError(409, 'Paper credentials changed; retry before any order is sent.');
        ctx.credential = fresh;
        if (await emergencyStopActive())
          throw new HttpError(409, 'Paper writes are paused by the emergency stop.');
        return work();
      });
    } finally {
      activeLocks -= 1;
    }
  },
  async findIntent(accountId, clientOrderId) {
    const [row] = await db
      .select(columns)
      .from(helenaPaperOrderIntent)
      .where(at(accountId, clientOrderId));
    return row ? (row as PaperIntent) : null;
  },
  async activeIntents(accountId) {
    return (await db
      .select(columns)
      .from(helenaPaperOrderIntent)
      .where(
        and(
          eq(helenaPaperOrderIntent.accountId, accountId),
          or(
            ne(helenaPaperOrderIntent.state, 'terminal'),
            gte(helenaPaperOrderIntent.createdAt, new Date(Date.now() - 26 * 3600 * 1000)),
          ),
        ),
      )
      .limit(500)) as PaperIntent[];
  },
  async beginIntent(ctx, intent) {
    if (await emergencyStopActive())
      throw new HttpError(409, 'Paper writes are paused by the emergency stop.');
    await db.insert(helenaPaperOrderIntent).values({
      accountId: intent.accountId,
      clientOrderId: intent.clientOrderId,
      requestHash: intent.requestHash,
      projectId: ctx.project!.id,
      credentialId: ctx.credentialId!,
      state: 'uncertain',
    });
  },
  async finishIntent(intent, order: AlpacaOrder) {
    await db
      .update(helenaPaperOrderIntent)
      .set({
        brokerOrder: order,
        state: terminalOrder(order) ? 'terminal' : 'active',
        updatedAt: new Date(),
      })
      .where(at(intent.accountId, intent.clientOrderId));
  },
  authorizeStrategy: assertStrategyApproval,
};
