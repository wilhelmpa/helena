import { createHash } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import {
  db,
  getSetting,
  helenaReceipt,
  helenaReceiptOriginalLink,
  project,
  setSetting,
} from '@repo/db';
import {
  absoluteVaultPath,
  assertNoSymlink,
  commitVaultPaths,
  composeNote,
  indexVaultPaths,
  PLAN_AUTHOR,
  readVaultFile,
  splitNote,
  walkVault,
  writeVaultFile,
  VaultError,
} from '@repo/vault';
import { reindexVaultItems } from '#modules/knowledge/service';
import { HttpError } from '#shared/lib';

export const RECEIPTS_BASE = `filters:\n  and:\n    - 'file.inFolder("Projects/PROJECT/Files/Belege")'\n    - 'note.type == "receipt"'\nviews:\n  - type: table\n    name: Belege\n    order:\n      - file.name\n      - note.invoice_date\n      - note.issuer\n      - note.total_gross\n      - note.vat_amount\n      - note.status\n      - note.pair_id\n`;

const key = (teamId: number) => `volition.receipt-projection.team.${teamId}`;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export async function receiptProjectionSetting(teamId: number) {
  return { enabled: (await getSetting<boolean>(key(teamId))) === true };
}

export async function setReceiptProjectionSetting(teamId: number, enabled: boolean) {
  const previous = (await receiptProjectionSetting(teamId)).enabled;
  await setSetting(key(teamId), enabled);
  const projects = await db
    .select({ id: project.id })
    .from(project)
    .where(eq(project.teamId, teamId));
  try {
    for (const item of projects) await rebuildReceiptProjection(item.id);
  } catch (error) {
    await setSetting(key(teamId), previous);
    await Promise.allSettled(projects.map((item) => rebuildReceiptProjection(item.id)));
    throw error;
  }
  return { enabled };
}

function receiptNotePath(projectKey: string, receipt: typeof helenaReceipt.$inferSelect): string {
  const month = (receipt.invoiceDate ?? receipt.createdAt.toISOString()).slice(0, 7);
  return `Projects/${projectKey}/Files/Belege/${month}/${receipt.id}.md`;
}

function noteContent(
  projectKey: string,
  receipt: typeof helenaReceipt.$inferSelect,
  originals: string[],
): string {
  const properties = {
    type: 'receipt',
    schema_version: 1,
    generated: true,
    project: projectKey,
    origin: 'system',
    receipt_id: receipt.id,
    pair_id: receipt.id,
    issuer: receipt.issuer,
    invoice_date: receipt.invoiceDate,
    total_gross: receipt.totalGross ? Number(receipt.totalGross) : null,
    vat_amount: receipt.vatAmount ? Number(receipt.vatAmount) : null,
    currency: receipt.currency,
    status: receipt.status,
    originals,
  };
  const body = `# Receipt ${receipt.id}\n\nGenerated from the receipt database. Editing this note does not change the receipt.\n`;
  const plain = composeNote(properties, body, null);
  return composeNote({ ...properties, projection_hash: hash(plain) }, body, null);
}

function isProjection(content: string): boolean {
  const note = splitNote(content);
  if (note.frontmatter.type !== 'receipt' || note.frontmatter.generated !== true) return false;
  const { projection_hash: expected, ...properties } = note.frontmatter;
  return (
    typeof expected === 'string' && hash(composeNote(properties, note.body, null)) === expected
  );
}

async function current(relative: string): Promise<{ content: string; sha256: string } | null> {
  try {
    const file = await readVaultFile(relative, 2 * 1024 * 1024);
    return { content: file.bytes.toString('utf8'), sha256: file.sha256 };
  } catch (error) {
    if (error instanceof VaultError && error.status === 404) return null;
    throw error;
  }
}

// Reconcile after DB transactions. A supplementary original is represented only in
// the primary note's originals array, so Base totals count one economic receipt.
export async function rebuildReceiptProjection(projectId: number) {
  const [owner] = await db
    .select({ key: project.key, teamId: project.teamId })
    .from(project)
    .where(eq(project.id, projectId));
  if (!owner) throw new HttpError(404, 'Project not found');
  const enabled = (await receiptProjectionSetting(owner.teamId)).enabled;
  const root = `Projects/${owner.key}/Files/Belege`;
  const rows = enabled
    ? await db.select().from(helenaReceipt).where(eq(helenaReceipt.projectId, projectId))
    : [];
  const links = enabled
    ? await db
        .select()
        .from(helenaReceiptOriginalLink)
        .where(eq(helenaReceiptOriginalLink.projectId, projectId))
    : [];
  const childIds = new Set(links.map((link) => link.receiptId));
  const originals = new Map<number, string[]>();
  for (const link of links) {
    const child = rows.find((row) => row.id === link.receiptId);
    if (child)
      originals.set(link.primaryReceiptId, [
        ...(originals.get(link.primaryReceiptId) ?? []),
        child.vaultPath,
      ]);
  }
  const desired = new Map<string, string>();
  for (const receipt of rows) {
    if (childIds.has(receipt.id)) continue;
    desired.set(
      receiptNotePath(owner.key, receipt),
      noteContent(owner.key, receipt, [receipt.vaultPath, ...(originals.get(receipt.id) ?? [])]),
    );
  }
  const changed: string[] = [];
  for (const relative of await walkVault(root)) {
    if (!/\/\d+\.md$/.test(relative)) continue;
    const file = await current(relative);
    if (!file || splitNote(file.content).frontmatter.generated !== true) continue;
    if (!isProjection(file.content))
      throw new HttpError(409, `Externally edited projection: ${relative}`);
    if (!desired.has(relative)) {
      await assertNoSymlink(relative);
      await rm(absoluteVaultPath(relative));
      changed.push(relative);
    }
  }
  for (const [relative, content] of desired) {
    const existing = await current(relative);
    if (existing?.content === content) continue;
    if (existing && !isProjection(existing.content)) {
      throw new HttpError(409, `Projection path is occupied or edited: ${relative}`);
    }
    await writeVaultFile(relative, Buffer.from(content), existing?.sha256 ?? null);
    changed.push(relative);
  }
  const basePath = `${root}/Belege.base`;
  const base = RECEIPTS_BASE.replace('PROJECT', owner.key);
  const existingBase = await current(basePath);
  if (enabled && !existingBase) {
    await writeVaultFile(basePath, Buffer.from(base), null);
    changed.push(basePath);
  } else if (!enabled && existingBase?.content === base) {
    await assertNoSymlink(basePath);
    await rm(absoluteVaultPath(basePath));
    changed.push(basePath);
  }
  if (changed.length) {
    await indexVaultPaths(changed, { author: 'system:receipt-projection' });
    await commitVaultPaths(changed, `Update receipt projection for ${owner.key}`, PLAN_AUTHOR);
    await reindexVaultItems(changed);
  }
  return {
    enabled,
    projected: desired.size,
    changed: changed.length,
    basePath: enabled ? basePath : null,
  };
}
