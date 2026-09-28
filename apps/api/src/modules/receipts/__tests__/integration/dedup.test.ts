import { beforeEach, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { db, helenaReceipt, helenaReceiptOriginalLink, helenaReceiptPairHistory } from '@repo/db';
import { eq } from 'drizzle-orm';
import { app, authedApi } from '#tests/helpers/app';
import { signUpTestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { inspectAfterIntake, listPairSuggestions, receiptDedupSetting } from '../../dedup';
import { unlinkReceiptOriginal } from '../../originals';
import { makePdf } from '../pdf';
import { auditReceiptPairs } from '../../../../scripts/receipt-pair-audit';

beforeEach(resetDb);

async function setup() {
  const owner = await signUpTestUser();
  const api = authedApi(owner.cookie);
  const project = (await api.projects.post({ key: 'DEDUP', name: 'Synthetic receipt pairs' }))
    .data!;
  const other = (await api.projects.post({ key: 'OTHER', name: 'Other project' })).data!;
  let serial = 0;
  async function receipt(input: {
    role?: 'Invoice' | 'Receipt';
    issuer: string;
    reference?: string;
    amount?: string;
    currency?: string;
    date?: string;
    target?: typeof project;
  }) {
    serial++;
    const target = input.target ?? project;
    const lines = [
      input.role,
      input.issuer,
      input.reference && `Invoice number: ${input.reference}`,
      input.role === 'Invoice' &&
        input.amount &&
        `Total: ${input.amount} ${input.currency ?? 'EUR'}`,
      input.role === 'Receipt' &&
        input.amount &&
        `Amount paid: ${input.amount} ${input.currency ?? 'EUR'}`,
    ]
      .filter(Boolean)
      .join('\n');
    const [row] = await db
      .insert(helenaReceipt)
      .values({
        teamId: target.teamId,
        projectId: target.id,
        source: 'upload',
        vaultPath: `Projects/${target.key}/Files/Belege/${serial}.pdf`,
        filename: `${serial}.pdf`,
        size: 1,
        sha256: createHash('sha256').update(`${serial}:${target.key}`).digest('hex'),
        issuer: input.issuer,
        invoiceNumber: input.reference ?? null,
        invoiceDate: input.date ?? '2026-09-05',
        totalGross: input.amount ?? null,
        currency: input.currency ?? 'EUR',
        textExcerpt: lines,
      })
      .returning();
    return row!;
  }
  return { owner, api, project, other, receipt };
}

it('links a unique USD invoice and paid receipt, records it, and keeps undo stable on recheck', async () => {
  const f = await setup();
  expect(await receiptDedupSetting(f.project.teamId)).toEqual({ autoMerge: true });
  const invoice = await f.receipt({
    role: 'Invoice',
    issuer: 'Synthetic Cloud',
    reference: 'US-42',
    amount: '23.80',
    currency: 'USD',
  });
  const payment = await f.receipt({
    role: 'Receipt',
    issuer: 'Synthetic Cloud',
    reference: 'US-42',
    amount: '23.80',
    currency: 'USD',
    date: '2026-09-09',
  });
  expect(await inspectAfterIntake(f.project.id, [payment.id], true)).toMatchObject([
    { kind: 'auto', primaryReceiptId: invoice.id },
  ]);
  expect(await db.select().from(helenaReceiptOriginalLink)).toMatchObject([
    { receiptId: payment.id, primaryReceiptId: invoice.id },
  ]);
  expect(await db.select().from(helenaReceiptPairHistory)).toMatchObject([{ action: 'auto_link' }]);
  const historyResponse = await app.handle(
    new Request(`http://localhost/teams/${f.project.teamId}/receipt-dedup/history`, {
      headers: { cookie: f.owner.cookie },
    }),
  );
  expect(historyResponse.status).toBe(200);
  expect(await historyResponse.json()).toMatchObject({
    items: [{ projectKey: f.project.key, action: 'auto_link' }],
  });
  await unlinkReceiptOriginal(f.project.id, payment.id, invoice.id);
  await inspectAfterIntake(f.project.id, [payment.id], true);
  expect(await db.select().from(helenaReceiptOriginalLink)).toHaveLength(0);
  expect((await db.select().from(helenaReceiptPairHistory)).map((row) => row.action)).toEqual([
    'auto_link',
    'unlink',
  ]);
});

it('links a unique EUR Paddle pair and scopes candidates to one project', async () => {
  const f = await setup();
  const invoice = await f.receipt({
    role: 'Invoice',
    issuer: 'Paddle',
    reference: 'PDL-55',
    amount: '49.00',
  });
  const foreign = await f.receipt({
    role: 'Receipt',
    issuer: 'Paddle',
    reference: 'PDL-55',
    amount: '49.00',
    target: f.other,
  });
  expect(await inspectAfterIntake(f.other.id, [foreign.id], true)).toEqual([]);
  const payment = await f.receipt({
    role: 'Receipt',
    issuer: 'Paddle',
    reference: 'PDL-55',
    amount: '49.00',
  });
  expect(await inspectAfterIntake(f.project.id, [payment.id], true)).toMatchObject([
    { kind: 'auto', primaryReceiptId: invoice.id },
  ]);
});

it('requires matching amount, currency, reference, issuer and a seven-day date window', async () => {
  const f = await setup();
  await f.receipt({
    role: 'Invoice',
    issuer: 'Synthetic Seller',
    reference: 'INV-90',
    amount: '20.00',
  });
  const variations = [
    { issuer: 'Synthetic Seller', reference: 'INV-90', amount: '21.00' },
    { issuer: 'Synthetic Seller', reference: 'INV-90', amount: '20.00', currency: 'USD' },
    { issuer: 'Synthetic Seller', reference: 'INV-90', amount: '20.00', date: '2026-09-13' },
    { issuer: 'Synthetic Seller', reference: 'INV-91', amount: '20.00' },
    { issuer: 'Other Seller', reference: 'INV-90', amount: '20.00' },
  ];
  for (const variation of variations) {
    const payment = await f.receipt({ role: 'Receipt', ...variation });
    expect(
      (await inspectAfterIntake(f.project.id, [payment.id], true)).some(
        (item) => item.kind === 'auto',
      ),
    ).toBe(false);
  }
  expect(await db.select().from(helenaReceiptOriginalLink)).toHaveLength(0);
});

it('suggests same-day Cloudflare notices with a missing amount and never links them automatically', async () => {
  const f = await setup();
  await f.receipt({ issuer: 'Cloudflare', amount: '15.00' });
  const notice = await f.receipt({ issuer: 'Cloudflare' });
  expect(await inspectAfterIntake(f.project.id, [notice.id], true)).toMatchObject([
    { kind: 'duplicate' },
  ]);
  expect(await db.select().from(helenaReceiptOriginalLink)).toHaveLength(0);
  expect(await listPairSuggestions(f.project.id)).toMatchObject([
    { kind: 'duplicate', status: 'pending' },
  ]);
  const inboxResponse = await app.handle(
    new Request(`http://localhost/teams/${f.project.teamId}/receipt-dedup/suggestions`, {
      headers: { cookie: f.owner.cookie },
    }),
  );
  expect(inboxResponse.status).toBe(200);
  expect(await inboxResponse.json()).toMatchObject({
    items: [{ projectKey: f.project.key, kind: 'duplicate' }],
  });
  expect(await inspectAfterIntake(f.project.id, [notice.id], true)).toHaveLength(1);
  expect(await listPairSuggestions(f.project.id)).toHaveLength(1);
  const suggestionId = (await listPairSuggestions(f.project.id))[0]!.id;
  const ignore = () =>
    app.handle(
      new Request(
        `http://localhost/projects/${f.project.key}/receipts/pair-suggestions/${suggestionId}`,
        {
          method: 'POST',
          headers: { cookie: f.owner.cookie, 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'ignore' }),
        },
      ),
    );
  expect((await ignore()).status).toBe(200);
  expect((await ignore()).status).toBe(409);
  await inspectAfterIntake(f.project.id, [notice.id], true);
  expect(await listPairSuggestions(f.project.id)).toHaveLength(0);
});

it('respects the team switch and returns the existing SHA reference on repeated upload', async () => {
  const f = await setup();
  const setting = f.api.teams({ teamId: f.project.teamId })['receipt-dedup'];
  expect((await setting.get()).data).toEqual({ autoMerge: true });
  expect((await setting.put({ autoMerge: false })).status).toBe(200);
  expect(await receiptDedupSetting(f.project.teamId)).toEqual({ autoMerge: false });
  const invoice = await f.receipt({
    role: 'Invoice',
    issuer: 'Paddle',
    reference: 'PDL-77',
    amount: '19.00',
  });
  const payment = await f.receipt({
    role: 'Receipt',
    issuer: 'Paddle',
    reference: 'PDL-77',
    amount: '19.00',
  });
  await inspectAfterIntake(f.project.id, [payment.id], false);
  expect(await db.select().from(helenaReceiptOriginalLink)).toHaveLength(0);
  expect(await listPairSuggestions(f.project.id)).toMatchObject([
    { receiptId: invoice.id, candidateId: payment.id, kind: 'pair' },
  ]);
  const pdf = makePdf(['Invoice', 'Invoice number: UNIQUE-1', 'Total: 12.00 EUR']);
  const file = () => new File([pdf], 'unique.pdf', { type: 'application/pdf' });
  const first = await f.api.projects({ projectKey: f.project.key }).receipts.post({ file: file() });
  expect(first.status).toBe(201);
  const second = await f.api
    .projects({ projectKey: f.project.key })
    .receipts.post({ file: file() });
  expect(second.status).toBe(409);
  const rows = await db
    .select()
    .from(helenaReceipt)
    .where(eq(helenaReceipt.sha256, createHash('sha256').update(pdf).digest('hex')));
  expect(rows).toHaveLength(1);
  expect(second.error?.value).toMatchObject({ existingId: rows[0]!.id });
});

it('pairs two separate real uploads before bank matching', async () => {
  const f = await setup();
  const invoice = makePdf([
    'Invoice',
    'Paddle Ltd',
    'Invoice number: PDL-88',
    'Invoice date: 2026-09-05',
    'Total: 31.00 EUR',
  ]);
  const payment = makePdf([
    'Receipt',
    'Paddle Ltd',
    'Invoice number: PDL-88',
    'Invoice date: 2026-09-07',
    'Amount paid: 31.00 EUR',
  ]);
  const upload = (bytes: string, name: string) =>
    f.api
      .projects({ projectKey: f.project.key })
      .receipts.post({ file: new File([bytes], name, { type: 'application/pdf' }) });
  expect((await upload(invoice, 'invoice.pdf')).status).toBe(201);
  expect((await upload(payment, 'payment.pdf')).status).toBe(201);
  expect(await db.select().from(helenaReceiptOriginalLink)).toHaveLength(1);
  expect(await db.select().from(helenaReceiptPairHistory)).toMatchObject([{ action: 'auto_link' }]);
});

it('holds ambiguous matches for review and resolves a suggestion through the project API', async () => {
  const f = await setup();
  const first = await f.receipt({
    role: 'Invoice',
    issuer: 'Paddle',
    reference: 'AMB-1',
    amount: '20.00',
  });
  await f.receipt({ role: 'Invoice', issuer: 'Paddle', reference: 'AMB-1', amount: '20.00' });
  const payment = await f.receipt({
    role: 'Receipt',
    issuer: 'Paddle',
    reference: 'AMB-1',
    amount: '20.00',
  });
  expect(await inspectAfterIntake(f.project.id, [payment.id], true)).toHaveLength(2);
  expect(await db.select().from(helenaReceiptOriginalLink)).toHaveLength(0);
  const suggestions = await listPairSuggestions(f.project.id);
  expect(suggestions).toHaveLength(2);
  const response = await app.handle(
    new Request(
      `http://localhost/projects/${f.project.key}/receipts/pair-suggestions/${suggestions[0]!.id}`,
      {
        method: 'POST',
        headers: { cookie: f.owner.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'link', primaryReceiptId: first.id }),
      },
    ),
  );
  expect(response.status).toBe(200);
  expect(await db.select().from(helenaReceiptOriginalLink)).toMatchObject([
    { receiptId: payment.id, primaryReceiptId: first.id },
  ]);
  expect(await listPairSuggestions(f.project.id)).toHaveLength(0);
});

it('audits the inventory without writes by default and applies only a unique pair', async () => {
  const f = await setup();
  await f.receipt({
    role: 'Invoice',
    issuer: 'Synthetic Cloud',
    reference: 'AUD-1',
    amount: '27.00',
    currency: 'USD',
  });
  await f.receipt({
    role: 'Receipt',
    issuer: 'Synthetic Cloud',
    reference: 'AUD-1',
    amount: '27.00',
    currency: 'USD',
  });
  const dry = await auditReceiptPairs();
  expect(dry).toMatchObject({ mode: 'dry', findings: [{ kind: 'auto', projectId: f.project.id }] });
  expect(await db.select().from(helenaReceiptOriginalLink)).toHaveLength(0);
  expect(await db.select().from(helenaReceiptPairHistory)).toHaveLength(0);
  expect(await auditReceiptPairs(true)).toMatchObject({
    mode: 'apply',
    findings: [{ kind: 'auto' }],
  });
  expect(await db.select().from(helenaReceiptOriginalLink)).toHaveLength(1);
  expect((await auditReceiptPairs(true)).findings).toHaveLength(0);
});
