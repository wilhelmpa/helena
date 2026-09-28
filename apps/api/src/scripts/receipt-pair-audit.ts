import { db, helenaReceipt } from '@repo/db';
import { eq } from 'drizzle-orm';
import { autoMergeEnabled, inspectNewReceipts, type PairFinding } from '#modules/receipts/dedup';

type AuditResult = { mode: 'dry' | 'apply'; findings: (PairFinding & { projectId: number })[] };
class DryRollback extends Error {
  constructor(readonly result: AuditResult) {
    super('Dry run rolled back');
  }
}

export async function auditReceiptPairs(apply = false): Promise<AuditResult> {
  const projects = await db
    .selectDistinct({ projectId: helenaReceipt.projectId, teamId: helenaReceipt.teamId })
    .from(helenaReceipt);
  const enabled = new Map(
    await Promise.all(
      projects.map(async (item) => [item.projectId, await autoMergeEnabled(item.teamId)] as const),
    ),
  );
  try {
    return await db.transaction(async (tx) => {
      const findings: AuditResult['findings'] = [];
      for (const project of projects) {
        const ids = await tx
          .select({ id: helenaReceipt.id })
          .from(helenaReceipt)
          .where(eq(helenaReceipt.projectId, project.projectId));
        const result = await inspectNewReceipts(
          tx,
          project.projectId,
          ids.map((row) => row.id),
          enabled.get(project.projectId) ?? true,
        );
        findings.push(...result.map((item) => ({ ...item, projectId: project.projectId })));
      }
      const report: AuditResult = { mode: apply ? 'apply' : 'dry', findings };
      if (!apply) throw new DryRollback(report);
      return report;
    });
  } catch (error) {
    if (error instanceof DryRollback) return error.result;
    throw error;
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some((arg) => arg !== '--dry' && arg !== '--apply'))
    throw new Error('Usage: bun src/scripts/receipt-pair-audit.ts [--dry|--apply]');
  console.log(JSON.stringify(await auditReceiptPairs(args[0] === '--apply'), null, 2));
  process.exit(0);
}
