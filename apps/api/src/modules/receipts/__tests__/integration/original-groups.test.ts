import { beforeEach, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  db,
  helenaBankAccount,
  helenaBankTransaction,
  helenaReceipt,
  helenaReceiptMatch,
  helenaReceiptOriginalLink,
} from '@repo/db';
import { absoluteVaultPath } from '@repo/vault';
import { readExportZip } from '@helena/finance';
import { eq, sql } from 'drizzle-orm';
import { app, authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { HttpError } from '#shared/lib';
import { linkReceiptOriginal, unlinkReceiptOriginal } from '../../originals';
import { deleteReceipt, listReceipts, receiptSummary, updateReceipt } from '../../receipts';
import { matchManually, matchReceipt, receiptCandidates, useReceiptDecider } from '../../matching';
import { monthExport } from '../../export';
import { receiptDetailView } from '../../views';

beforeEach(resetDb);

async function setup() {
  const owner = await signUpTestUser();
  const api = authedApi(owner.cookie);
  const project = (await api.projects.post({ key: 'ORIGINALS', name: 'Fictional receipt groups' }))
    .data!;
  const other = (await api.projects.post({ key: 'OTHER', name: 'Other project' })).data!;
  async function original(label: string, target = project, number = 'FICTION-1') {
    const bytes = Buffer.from(`%PDF-fictional-${label}`);
    const vaultPath = `Projects/${target.key}/Files/Belege/${label}.pdf`;
    await mkdir(path.dirname(absoluteVaultPath(vaultPath)), { recursive: true });
    await writeFile(absoluteVaultPath(vaultPath), bytes);
    const [row] = await db
      .insert(helenaReceipt)
      .values({
        teamId: target.teamId,
        projectId: target.id,
        source: 'upload',
        vaultPath,
        filename: `${label}.pdf`,
        contentType: 'application/pdf',
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        issuer: 'Fictional Seller',
        invoiceNumber: number,
        invoiceDate: '2026-09-05',
        totalGross: '119.00',
        vatAmount: '19.00',
        currency: 'EUR',
        details: { paymentReference: label, ownerCorrection: 'preserve' },
      })
      .returning();
    return row!;
  }
  const invoice = await original('invoice');
  const payment = await original('payment');
  const distinct = await original('different', project, 'FICTION-2');
  const foreign = await original('foreign', other);
  const [account] = await db
    .insert(helenaBankAccount)
    .values({ teamId: project.teamId, projectId: project.id, name: 'Fiction' })
    .returning();
  const [transaction] = await db
    .insert(helenaBankTransaction)
    .values({
      teamId: project.teamId,
      projectId: project.id,
      bankAccountId: account!.id,
      bookingDate: '2026-09-05',
      amount: '-119.00',
      currency: 'EUR',
      dedupeKey: 'fictional-payment',
    })
    .returning();
  const route = (id: number, method: string, primaryReceiptId: number, cookie = owner.cookie) =>
    app.handle(
      new Request(`http://localhost/projects/${project.key}/receipts/${id}/original-link`, {
        method,
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ primaryReceiptId }),
      }),
    );
  return {
    owner,
    project,
    other,
    invoice,
    payment,
    distinct,
    foreign,
    transaction: transaction!,
    route,
  };
}

it('groups only by explicit owner action, keeps all original rows/facts/bytes, exports both originals once and reverses exactly', async () => {
  const f = await setup();
  const before = await db.select().from(helenaReceipt).orderBy(helenaReceipt.id);
  expect((await listReceipts(f.project.id, {})).map((r) => r.id).sort()).toEqual(
    [f.invoice.id, f.payment.id, f.distinct.id].sort(),
  );
  expect((await f.route(f.payment.id, 'PUT', f.invoice.id)).status).toBe(200);
  expect((await f.route(f.payment.id, 'PUT', f.invoice.id)).status).toBe(200); // idempotent
  expect(await db.select().from(helenaReceipt).orderBy(helenaReceipt.id)).toEqual(before);
  const rows = await listReceipts(f.project.id, {});
  expect(rows.map((r) => r.id).sort()).toEqual([f.invoice.id, f.distinct.id].sort());
  expect(rows.find((r) => r.id === f.invoice.id)?.originalCount).toBe(2);
  expect((await receiptSummary(f.project.id, '2026-09')).receipts.open).toBe(2);
  const child = await receiptDetailView(f.payment);
  expect(child.primaryReceiptId).toBe(f.invoice.id);
  expect(child.originals?.map((r) => r.id).sort()).toEqual([f.invoice.id, f.payment.id].sort());
  expect(child.totalGrossCents).toBe(11900); // original facts never zeroed
  expect((await matchReceipt(f.payment.id)).status).toBe('skipped');
  expect(await receiptCandidates(f.project.id, f.payment.id)).toEqual([]);
  await expect(
    matchManually(f.project.id, f.payment.id, f.transaction.id, f.owner.userId),
  ).rejects.toThrow();
  expect(await db.select().from(helenaReceiptMatch)).toHaveLength(0);
  const exported = readExportZip((await monthExport(f.project, '2026-09')).zip);
  const csv = Object.entries(exported).find(([p]) => p.endsWith('Belege-ohne-Zahlung.csv'))![1];
  expect(new TextDecoder().decode(csv).split('\r\n').filter(Boolean)).toHaveLength(3); // header + 2 economic receipts
  const pdfs = Object.entries(exported).filter(([p]) => p.endsWith('.pdf'));
  expect(pdfs).toHaveLength(3);
  expect(pdfs.map(([, b]) => Buffer.from(b).toString()).sort()).toEqual(
    ['%PDF-fictional-invoice', '%PDF-fictional-payment', '%PDF-fictional-different'].sort(),
  );
  for (const r of [f.invoice, f.payment])
    expect(
      createHash('sha256')
        .update(await readFile(absoluteVaultPath(r.vaultPath)))
        .digest('hex'),
    ).toBe(r.sha256);
  expect((await f.route(f.payment.id, 'DELETE', f.invoice.id)).status).toBe(200);
  expect(await db.select().from(helenaReceipt).orderBy(helenaReceipt.id)).toEqual(before);
  expect(await listReceipts(f.project.id, {})).toHaveLength(3);
  expect(await db.select().from(helenaReceiptOriginalLink)).toHaveLength(0);
});

it('rejects cross-project, self, nested, stale reassignment and unauthorised linking without changing rows', async () => {
  const f = await setup();
  const stranger = await signUpTestUser();
  expect((await f.route(f.payment.id, 'PUT', f.invoice.id, stranger.cookie)).status).not.toBe(200);
  expect((await f.route(f.payment.id, 'PUT', f.foreign.id)).status).toBe(404);
  expect((await f.route(f.foreign.id, 'PUT', f.invoice.id)).status).toBe(404);
  expect((await f.route(f.invoice.id, 'PUT', f.invoice.id)).status).toBe(409);
  await linkReceiptOriginal(f.project.id, f.payment.id, f.invoice.id, f.owner.userId);
  await expect(
    linkReceiptOriginal(f.project.id, f.invoice.id, f.distinct.id, f.owner.userId),
  ).rejects.toThrow();
  await expect(
    linkReceiptOriginal(f.project.id, f.distinct.id, f.payment.id, f.owner.userId),
  ).rejects.toThrow();
  await expect(
    linkReceiptOriginal(f.project.id, f.payment.id, f.distinct.id, f.owner.userId),
  ).rejects.toThrow();
  await expect(unlinkReceiptOriginal(f.project.id, f.payment.id, f.distinct.id)).rejects.toThrow();
  await expect(deleteReceipt(f.project.id, f.invoice.id)).rejects.toThrow();
  await expect(deleteReceipt(f.project.id, f.payment.id)).rejects.toThrow();
  await expect(updateReceipt(f.project.id, f.invoice.id, { status: 'ignored' })).rejects.toThrow();
  // Composite database FKs independently refuse a foreign primary.
  await expect(
    db
      .insert(helenaReceiptOriginalLink)
      .values({
        receiptId: f.distinct.id,
        primaryReceiptId: f.foreign.id,
        projectId: f.project.id,
        teamId: f.project.teamId,
      })
      .execute(),
  ).rejects.toThrow();
  expect(await db.select().from(helenaReceiptOriginalLink)).toHaveLength(1);
});

it('keeps existing bank references unchanged and rejects an already matched supplementary original', async () => {
  const f = await setup();
  await matchManually(f.project.id, f.payment.id, f.transaction.id, f.owner.userId);
  const matches = await db.select().from(helenaReceiptMatch);
  await expect(
    linkReceiptOriginal(f.project.id, f.payment.id, f.invoice.id, f.owner.userId),
  ).rejects.toThrow();
  expect(await db.select().from(helenaReceiptMatch)).toEqual(matches);
  // An existing primary match is retained when another open original is attached.
  await linkReceiptOriginal(f.project.id, f.invoice.id, f.payment.id, f.owner.userId);
  expect(await db.select().from(helenaReceiptMatch)).toEqual(matches);
  const csv = Object.entries(readExportZip((await monthExport(f.project, '2026-09')).zip)).find(
    ([p]) => p.endsWith('Buchungen_2026-09.csv'),
  )![1];
  const cells = new TextDecoder().decode(csv).split('\r\n')[1]!.split(';');
  expect(cells[2]).toBe('-119,00');
  expect(cells[13]).toBe('119,00');
  expect(cells[14]).toBe('19,00');
  await unlinkReceiptOriginal(f.project.id, f.invoice.id, f.payment.id);
  expect(await db.select().from(helenaReceiptMatch)).toEqual(matches);
});

it('preserves active proposal history and requires its explicit rejection before grouping', async () => {
  const f = await setup();
  const [proposal] = await db
    .insert(helenaReceiptMatch)
    .values({
      teamId: f.project.teamId,
      projectId: f.project.id,
      receiptId: f.payment.id,
      transactionId: f.transaction.id,
      status: 'proposed',
      method: 'rule',
    })
    .returning();
  await expect(
    linkReceiptOriginal(f.project.id, f.payment.id, f.invoice.id, f.owner.userId),
  ).rejects.toThrow();
  expect(await db.select().from(helenaReceiptMatch)).toEqual([proposal!]);
  await db
    .update(helenaReceiptMatch)
    .set({ status: 'rejected' })
    .where(eq(helenaReceiptMatch.id, proposal!.id));
  const rejected = await db.select().from(helenaReceiptMatch);
  await linkReceiptOriginal(f.project.id, f.payment.id, f.invoice.id, f.owner.userId);
  await unlinkReceiptOriginal(f.project.id, f.payment.id, f.invoice.id);
  expect(await db.select().from(helenaReceiptMatch)).toEqual(rejected);
});

it('serializes opposite group assignments and admits only one flat relationship', async () => {
  const f = await setup();
  const results = await Promise.allSettled([
    linkReceiptOriginal(f.project.id, f.payment.id, f.invoice.id, f.owner.userId),
    linkReceiptOriginal(f.project.id, f.invoice.id, f.payment.id, f.owner.userId),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  expect(await db.select().from(helenaReceiptOriginalLink)).toHaveLength(1);
});

for (const decided of [true, false])
  it(`rejects an in-flight ${decided ? 'confirmation' : 'proposal'} after its original was attached`, async () => {
    const f = await setup();
    // Weak identity/reference, exact amount: decision path rather than automatic matching.
    await db
      .update(helenaBankTransaction)
      .set({ counterpartyName: 'Unrelated Fiction', purpose: '', amount: '-118.00' })
      .where(eq(helenaBankTransaction.id, f.transaction.id));
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const resume = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reachedDecision = false;
    useReceiptDecider(async () => {
      reachedDecision = true;
      entered();
      await resume;
      return {
        status: decided ? 'decided' : 'unsure',
        credentialId: null,
        backend: 'test',
        model: 'test',
        latencyMs: 1,
        inputTokens: 0,
        outputTokens: 0,
        costEur: null,
        threshold: 0.85,
        error: null,
        answers: {
          match: {
            choice: `t:${f.transaction.id}`,
            confidence: 1,
            probabilities: { [`t:${f.transaction.id}`]: 1 },
            decided,
            decisionId: null,
          },
        },
      };
    });
    const pending = matchReceipt(f.payment.id);
    // Do not leave a failed candidate-selection regression waiting indefinitely.
    const timeout = setTimeout(entered, 2000);
    try {
      await started;
      clearTimeout(timeout);
      expect(reachedDecision).toBe(true);
      await linkReceiptOriginal(f.project.id, f.payment.id, f.invoice.id, f.owner.userId);
      release();
      await expect(pending).rejects.toThrow();
      expect(await db.select().from(helenaReceiptMatch)).toHaveLength(0);
      expect(
        (await db.select().from(helenaReceipt).where(eq(helenaReceipt.id, f.payment.id)))[0]!
          .status,
      ).toBe('open');
    } finally {
      clearTimeout(timeout);
      release();
      useReceiptDecider(null);
      await pending.catch(() => {});
    }
  });

it('takes project admission before manual match-row locks, including a concurrent delete', async () => {
  const f = await setup();
  await matchManually(f.project.id, f.payment.id, f.transaction.id, f.owner.userId);
  const [next] = await db
    .insert(helenaBankTransaction)
    .values({
      teamId: f.project.teamId,
      projectId: f.project.id,
      bankAccountId: f.transaction.bankAccountId,
      bookingDate: '2026-09-06',
      amount: '-119.00',
      currency: 'EUR',
      dedupeKey: 'second-fictional-payment',
    })
    .returning();
  type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
  let held!: (tx: Tx) => void;
  const ready = new Promise<Tx>((resolve) => {
    held = resolve;
  });
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const holder = db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(748220, ${f.project.id})`);
    held(tx);
    await released;
  });
  const tx = await ready;
  const moving = matchManually(f.project.id, f.payment.id, next!.id, f.owner.userId);
  // Capture rejection immediately so cleanup is deterministic even on the old lock order.
  const moved = moving.then(
    () => 'ok',
    (error: unknown) => error,
  );
  let deleted: Promise<unknown> | undefined;
  try {
    let waiting = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const result = await db.execute(
        sql`SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND classid = 748220 AND objid = ${f.project.id} AND NOT granted) AS waiting`,
      );
      if (result[0]?.waiting === true) {
        waiting = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(waiting).toBe(true);
    // Old code deletes/locks the confirmed match before waiting for admission. NOWAIT
    // would fail here; the new code has not touched it while waiting for the project lock.
    const locked = await tx.execute(
      sql`SELECT id FROM helena_receipt_match WHERE receipt_id = ${f.payment.id} FOR UPDATE NOWAIT`,
    );
    expect(locked).toHaveLength(1);
    deleted = deleteReceipt(f.project.id, f.payment.id).then(
      () => 'ok',
      (error: unknown) => error,
    );
    release();
    await holder;
    const moveResult = await moved;
    // The delete may win after the successful manual transaction and before its response
    // reads the receipt. Only that precise postcommit404 is acceptable, never a DB error.
    if (moveResult !== 'ok') {
      expect(moveResult).toBeInstanceOf(HttpError);
      expect((moveResult as HttpError).status).toBe(404);
      expect((moveResult as HttpError).message).toBe('Receipt not found');
    }
    expect(await deleted).toBe('ok');
    expect(
      await db.select().from(helenaReceipt).where(eq(helenaReceipt.id, f.payment.id)),
    ).toHaveLength(0);
    expect(await db.select().from(helenaReceiptMatch)).toHaveLength(0);
  } finally {
    release();
    await Promise.allSettled([holder, moved, ...(deleted ? [deleted] : [])]);
  }
}, 10000);
