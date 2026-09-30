import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readdir, writeFile } from 'node:fs/promises';
import { absoluteVaultPath, findEntry } from '@repo/vault';
import { readExportZip } from '@helena/finance';
import { db, helenaBankTransaction, helenaDecision, helenaMailClassification } from '@repo/db';
import { eq, sql } from 'drizzle-orm';
import { createAgent } from '#tests/helpers/agents';
import { apiKeyApi } from '#tests/helpers/app';
import { app, authedApi } from '#tests/helpers/app';
import { signUpTestUser, type TestUser } from '#tests/helpers/auth';
import { resetDb } from '#tests/helpers/db';
import { insertMailAccount, insertMessage } from '#tests/helpers/mail';
import { untaggedRoutes } from '#tests/helpers/mcp';
import { routeTools } from '#mcp/generate';
import type { DecideOutcome, DecideRequest } from '#modules/decisions/service';
import { getProjectByKey } from '#modules/projects/service';
import type { AccountView, ImportResult } from '../../accounts';
import { useReceiptDecider, type MatchOutcome, type ReviewItem } from '../../matching';
import { intakeMailReceipts, prepareMailReceipts } from '../../receipts';
import { backfillMailReceipts } from '../../../../scripts/mail-receipt-backfill';
import type { ReceiptDetailView, ReceiptView, TransactionView } from '../../views';
import { makePdf } from '../pdf';
import { retryReceiptFiling, useReceiptIntake } from '#modules/mail-triage/classify';
import { mailTriageConfig } from '#modules/mail-triage/config';

// Receipt matching end to end: statements in (CAMT and CSV, re-imported), receipts in (a
// Factur-X PDF, XRechnung UBL files, an invoice mail), matching by the rules alone, by a
// confident decision, as a proposal the owner confirms, rejects or replaces by hand, and the
// month's export. The decision model is a stand-in that logs its decisions like the real one.

const OWN = 'DE89370400440532013000';
const SAVINGS = 'DE45120300001234567890';
const SOFTWARE = 'DE42500105175407324385';
const HOSTING = 'DE65200411330987654321';

const facturX = readFileSync(
  new URL(
    '../../../../../../../packages/finance/src/__fixtures__/factur-x-en16931.xml',
    import.meta.url,
  ),
  'utf8',
);

function camtEntry(input: {
  cents: number;
  date: string;
  name?: string;
  iban?: string;
  purpose?: string;
  status?: string;
  ref: string;
}) {
  const amount = (Math.abs(input.cents) / 100).toFixed(2);
  const indicator = input.cents < 0 ? 'DBIT' : 'CRDT';
  const role = input.cents < 0 ? 'Cdtr' : 'Dbtr';
  const booked = input.status === 'PDNG' ? '' : `<BookgDt><Dt>${input.date}</Dt></BookgDt>`;
  return `<Ntry><Amt Ccy="EUR">${amount}</Amt><CdtDbtInd>${indicator}</CdtDbtInd>
    <Sts>${input.status ?? 'BOOK'}</Sts>${booked}<ValDt><Dt>${input.date}</Dt></ValDt>
    <AcctSvcrRef>${input.ref}</AcctSvcrRef><NtryDtls><TxDtls><RltdPties>
    <${role}><Nm>${input.name ?? ''}</Nm></${role}>
    ${input.iban ? `<${role}Acct><Id><IBAN>${input.iban}</IBAN></Id></${role}Acct>` : ''}
    </RltdPties><RmtInf><Ustrd>${input.purpose ?? ''}</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>`;
}

const CAMT = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt>
<Acct><Id><IBAN>${OWN}</IBAN></Id><Ccy>EUR</Ccy></Acct>
${camtEntry({ cents: -17250, date: '2026-09-20', name: 'MUSTER SOFTWARE GMBH', iban: SOFTWARE, purpose: 'Rechnung MS-10023', ref: 'A1' })}
${camtEntry({ cents: -5900, date: '2026-09-05', name: 'Hosting Anbieter GmbH', iban: HOSTING, purpose: 'Hosting September Kd 4711', ref: 'B1' })}
${camtEntry({ cents: -5900, date: '2026-09-12', name: 'Hosting Anbieter GmbH', iban: HOSTING, purpose: 'Hosting Zusatzpaket Kd 4711', ref: 'B2' })}
${camtEntry({ cents: -1200, date: '2026-09-25', name: 'Kiosk', purpose: 'Kartenzahlung', status: 'PDNG', ref: 'P1' })}
</Stmt></BkToCstmrStmt></Document>`;

const CSV = [
  `"Girokonto";"${SAVINGS}"`,
  '""',
  '"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"',
  '"03.09.26";"03.09.26";"Gebucht";"Beispiel Handel GmbH";"Erika Musterfrau";"RE-2026-0815";"Eingang";"DE17100500000123456789";"1.190,00 €";"";"";""',
  '"04.09.26";"04.09.26";"Gebucht";"Erika Musterfrau";"Kiosk am Markt";"Kaffee";"Ausgang";"";"-3,50 €";"";"";""',
].join('\n');

function ublInvoice(input: { id: string; issue: string; due: string; gross: string; net: string }) {
  const vat = ((Number(input.gross) * 100 - Number(input.net) * 100) / 100).toFixed(2);
  return `<?xml version="1.0" encoding="UTF-8"?>
<ubl:Invoice xmlns:ubl="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0</cbc:CustomizationID>
  <cbc:ID>${input.id}</cbc:ID>
  <cbc:IssueDate>${input.issue}</cbc:IssueDate>
  <cbc:DueDate>${input.due}</cbc:DueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PartyName><cbc:Name>Hosting Anbieter</cbc:Name></cac:PartyName>
    <cac:PartyLegalEntity><cbc:RegistrationName>Hosting Anbieter GmbH</cbc:RegistrationName></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cac:Party><cac:PartyName><cbc:Name>Erika Musterfrau</cbc:Name></cac:PartyName></cac:Party></cac:AccountingCustomerParty>
  <cac:PaymentMeans><cbc:PaymentMeansCode>58</cbc:PaymentMeansCode>
    <cac:PayeeFinancialAccount><cbc:ID>${HOSTING}</cbc:ID></cac:PayeeFinancialAccount></cac:PaymentMeans>
  <cac:TaxTotal><cbc:TaxAmount currencyID="EUR">${vat}</cbc:TaxAmount></cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:TaxExclusiveAmount currencyID="EUR">${input.net}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">${input.gross}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="EUR">${input.gross}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
</ubl:Invoice>`;
}

// Requests go straight to the app, with the session cookie; files as multipart.
function client(user: TestUser, projectKey = 'FIN') {
  const send = (method: string, path: string, body?: unknown) =>
    app.handle(
      new Request(`http://localhost/projects/${projectKey}/receipts${path}`, {
        method,
        headers:
          body === undefined || body instanceof FormData
            ? { cookie: user.cookie }
            : { cookie: user.cookie, 'content-type': 'application/json' },
        body:
          body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
      }),
    );
  async function call<T>(method: string, path: string, body?: unknown) {
    const res = await send(method, path, body);
    const text = await res.text();
    return { status: res.status, data: (text ? JSON.parse(text) : null) as T };
  }
  function upload<T>(path: string, name: string, content: string | Uint8Array, type: string) {
    const form = new FormData();
    form.append('file', new File([content], name, { type }));
    return call<T>('POST', path, form);
  }
  return { send, call, upload };
}

// The decision model's stand-in: logs a decision row like decide() does and answers with the
// transaction whose purpose contains `pick`.
function fakeDecider(pick: string, confidence: number, decided: boolean) {
  return async (request: DecideRequest): Promise<DecideOutcome> => {
    const question = request.questions.match as { options: { id: string; label: string }[] };
    const choice = question.options.find((option) => option.label.includes(pick))?.id ?? 'none';
    const [row] = await db
      .insert(helenaDecision)
      .values({
        teamId: request.teamId,
        projectId: request.projectId ?? null,
        classId: request.classId,
        subject: request.subject ?? null,
        questionId: 'match',
        kind: 'choice',
        options: question.options.map((option) => option.id),
        choice,
        probabilities: { [choice]: confidence },
        confidence,
        threshold: 0.85,
        status: decided ? 'decided' : 'unsure',
        inputHash: 'test',
      })
      .returning({ id: helenaDecision.id });
    return {
      status: decided ? 'decided' : 'unsure',
      answers: {
        match: {
          choice,
          probabilities: { [choice]: confidence },
          confidence,
          decided,
          decisionId: row!.id,
        },
      },
      credentialId: null,
      backend: 'test',
      model: 'test',
      latencyMs: 1,
      inputTokens: 0,
      outputTokens: 0,
      costEur: null,
      threshold: 0.85,
      error: null,
    };
  };
}

async function transactionId(purpose: string): Promise<number> {
  const [row] = await db
    .select({ id: helenaBankTransaction.id })
    .from(helenaBankTransaction)
    .where(eq(helenaBankTransaction.purpose, purpose));
  if (!row) throw new Error(`no transaction "${purpose}"`);
  return row.id;
}

async function decisionOutcome(id: number | null | undefined) {
  const [row] = await db
    .select({ outcome: helenaDecision.outcome, source: helenaDecision.outcomeSource })
    .from(helenaDecision)
    .where(eq(helenaDecision.id, id ?? 0));
  return row;
}

async function intakeDeadline<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Mail intake exceeded 5s pool deadline')), 5000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Failure injection belongs only to the private integration DB. Always remove in finally.
async function intakeFailure(table: 'helena_receipt' | 'vault_entry', condition: string) {
  if (!(process.env.DATABASE_URL ?? '').split('/').pop()?.includes('test'))
    throw new Error('Intake failure injection requires a private test DB');
  await db.execute(
    sql.raw(`CREATE FUNCTION test_mail_intake_failure() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN
      IF ${condition} THEN RAISE EXCEPTION 'Synthetic mail intake SQL failure'; END IF;
      RETURN NEW;
    END $$`),
  );
  try {
    await db.execute(
      sql.raw(`CREATE TRIGGER test_mail_intake_failure BEFORE INSERT ON ${table}
      FOR EACH ROW EXECUTE FUNCTION test_mail_intake_failure()`),
    );
  } catch (error) {
    await db.execute(sql.raw('DROP FUNCTION test_mail_intake_failure()'));
    throw error;
  }
  return async () => {
    await db.execute(sql.raw(`DROP TRIGGER test_mail_intake_failure ON ${table}`));
    await db.execute(sql.raw('DROP FUNCTION test_mail_intake_failure()'));
  };
}

describe('receipts', () => {
  let owner: TestUser;
  let http: ReturnType<typeof client>;

  beforeEach(async () => {
    await resetDb();
    owner = await signUpTestUser();
    await authedApi(owner.cookie).projects.post({ key: 'FIN', name: 'Finanzen' });
    http = client(owner);
  });

  afterEach(() => useReceiptDecider(null));

  it('imports statements, matches receipts by rule, decision, review and hand, and exports', async () => {
    // A bank account and its CAMT statement; the pending entry is left out.
    const account = await http.call<AccountView>('POST', '/accounts', { name: 'Geschäftskonto' });
    expect(account.status).toBe(201);
    const imported = await http.upload<ImportResult>(
      `/accounts/${account.data.id}/imports`,
      'auszug.xml',
      CAMT,
      'application/xml',
    );
    expect(imported.status).toBe(201);
    expect(imported.data).toMatchObject({
      format: 'camt053',
      entries: 3,
      added: 3,
      duplicates: 0,
      pending: 1,
      fromDate: '2026-09-05',
      toDate: '2026-09-20',
    });
    const again = await http.upload<ImportResult>(
      `/accounts/${account.data.id}/imports`,
      'auszug-2.xml',
      CAMT,
      'application/xml',
    );
    expect(again.data).toMatchObject({ added: 0, duplicates: 3 });
    const accounts = await http.call<{ accounts: AccountView[] }>('GET', '/accounts');
    expect(accounts.data.accounts[0]).toMatchObject({ iban: OWN, open: 3, transactions: 3 });

    // A second account learns its IBAN from its CSV; a statement of the first is refused there.
    const savings = await http.call<AccountView>('POST', '/accounts', { name: 'Tagesgeld' });
    const csv = await http.upload<ImportResult>(
      `/accounts/${savings.data.id}/imports`,
      'umsaetze.csv',
      CSV,
      'text/csv',
    );
    expect(csv.data).toMatchObject({ format: 'csv', added: 2, duplicates: 0 });
    const csvAgain = await http.upload<ImportResult>(
      `/accounts/${savings.data.id}/imports`,
      'umsaetze.csv',
      CSV,
      'text/csv',
    );
    expect(csvAgain.data).toMatchObject({ added: 0, duplicates: 2 });
    const wrong = await http.upload<ImportResult>(
      `/accounts/${savings.data.id}/imports`,
      'auszug.xml',
      CAMT,
      'application/xml',
    );
    expect(wrong.data.added).toBe(0);
    expect(wrong.data.warnings.join(' ')).toContain('another account');
    const withIban = await http.call<{ accounts: AccountView[] }>('GET', '/accounts');
    expect(withIban.data.accounts.find((a) => a.id === savings.data.id)?.iban).toBe(SAVINGS);

    // A Factur-X PDF: read from its embedded XML, matched by the rules alone.
    const pdf = makePdf(
      ['Muster Software GmbH', 'Rechnung MS-10023', 'Gesamtbetrag 172,50 EUR'],
      [{ name: 'factur-x.xml', content: facturX }],
    );
    const software = await http.upload<ReceiptDetailView>(
      '',
      'MS-10023.pdf',
      pdf,
      'application/pdf',
    );
    expect(software.status).toBe(201);
    expect(software.data).toMatchObject({
      source: 'upload',
      extraction: 'zugferd',
      einvoice: true,
      issuer: 'Muster Software GmbH',
      invoiceNumber: 'MS-10023',
      invoiceDate: '2026-09-01',
      totalGrossCents: 17250,
      status: 'matched',
      vaultPath: 'Projects/FIN/Files/Belege/2026-09/MS-10023.pdf',
    });
    expect(software.data.match).toMatchObject({ method: 'rule', amountCents: -17250 });
    const duplicate = await http.upload<{ code: string; existingId: number }>(
      '',
      'nochmal.pdf',
      pdf,
      'application/pdf',
    );
    expect(duplicate.status).toBe(409);
    expect(duplicate.data).toMatchObject({ code: 'duplicate', existingId: software.data.id });

    // Two equal hosting payments: the rules cannot tell them apart, the decision model picks
    // one with confidence; the amount is exact, so it stands without the owner.
    const b1 = await transactionId('Hosting September Kd 4711');
    const b2 = await transactionId('Hosting Zusatzpaket Kd 4711');
    useReceiptDecider(fakeDecider('Hosting September', 0.95, true));
    const hosting = await http.upload<ReceiptDetailView>(
      '',
      'H-2026-09.xml',
      ublInvoice({
        id: 'H-2026-09',
        issue: '2026-09-01',
        due: '2026-09-15',
        gross: '59.00',
        net: '49.58',
      }),
      'application/xml',
    );
    expect(hosting.data).toMatchObject({ extraction: 'xrechnung', status: 'matched' });
    expect(hosting.data.match).toMatchObject({
      method: 'decision',
      transactionId: b1,
      confidence: 0.95,
    });

    // 60 € against the other 59 € payment: close, not exact. The model is unsure, so the
    // rules' candidate waits in the review list.
    useReceiptDecider(fakeDecider('Hosting Zusatzpaket', 0.6, false));
    const extra = await http.upload<ReceiptDetailView>(
      '',
      'H-2026-10.xml',
      ublInvoice({
        id: 'H-2026-10',
        issue: '2026-09-10',
        due: '2026-09-20',
        gross: '60.00',
        net: '50.42',
      }),
      'application/xml',
    );
    expect(extra.data).toMatchObject({ status: 'open', proposals: 1 });
    const review = await http.call<{ items: ReviewItem[] }>('GET', '/review?month=2026-09');
    expect(review.data.items).toHaveLength(1);
    const proposal = review.data.items[0]!;
    expect(proposal).toMatchObject({ method: 'rule', confidence: 0.6 });
    expect(proposal.transaction.id).toBe(b2);
    expect(proposal.candidates[0]).toMatchObject({ amount: 'near', identity: 'iban' });
    const [{ decisionId: proposalDecision }] = await db
      .select({ decisionId: helenaDecision.id })
      .from(helenaDecision)
      .where(eq(helenaDecision.subject, `receipt:${extra.data.id}`));

    // Rejected: the decision learns "none", and the transaction is not proposed again.
    const rejected = await http.call<{ receipt: ReceiptView }>(
      'POST',
      `/matches/${proposal.matchId}/reject`,
    );
    expect(rejected.data.receipt).toMatchObject({ status: 'open', proposals: 0 });
    expect(await decisionOutcome(proposalDecision)).toEqual({ outcome: 'none', source: 'caller' });
    const rematch = await http.call<{ outcome: MatchOutcome }>('POST', `/${extra.data.id}/match`);
    expect(rematch.data.outcome.status).toBe('no_candidates');

    // By hand after all: the decision learns the transaction.
    const manual = await http.call<{ receipt: ReceiptView }>(
      'POST',
      `/${extra.data.id}/match-manual`,
      { transactionId: b2 },
    );
    expect(manual.data.receipt).toMatchObject({ status: 'matched' });
    expect(manual.data.receipt.match).toMatchObject({ method: 'manual', transactionId: b2 });
    expect(await decisionOutcome(proposalDecision)).toEqual({
      outcome: `t:${b2}`,
      source: 'caller',
    });

    // Undone, matched again: proposed once more, and this time the owner confirms it.
    await http.send('DELETE', `/matches/${manual.data.receipt.match!.matchId}`);
    const afterUnmatch = await http.call<{ transactions: TransactionView[] }>(
      'GET',
      '/transactions?status=open&month=2026-09',
    );
    expect(afterUnmatch.data.transactions.map((t) => t.id)).toContain(b2);
    const proposedAgain = await http.call<{ outcome: MatchOutcome }>(
      'POST',
      `/${extra.data.id}/match`,
    );
    expect(proposedAgain.data.outcome.status).toBe('proposed');
    const confirmed = await http.call<{ receipt: ReceiptView }>(
      'POST',
      `/matches/${proposedAgain.data.outcome.matchId}/confirm`,
    );
    expect(confirmed.data.receipt).toMatchObject({ status: 'matched' });
    expect(confirmed.data.receipt.match).toMatchObject({ transactionId: b2, method: 'rule' });

    // The coffee needs no receipt.
    const kiosk = await transactionId('Kaffee');
    const ignored = await http.call<TransactionView>('PATCH', `/transactions/${kiosk}`, {
      status: 'ignored',
    });
    expect(ignored.data.status).toBe('ignored');
    // A note leaves the status alone.
    const noted = await http.call<TransactionView>('PATCH', `/transactions/${kiosk}`, {
      note: 'Kaffee für das Team',
    });
    expect(noted.data).toMatchObject({ status: 'ignored', note: 'Kaffee für das Team' });

    const summary = await http.call<{
      transactions: Record<string, number>;
      receipts: Record<string, number>;
      proposals: number;
      months: string[];
    }>('GET', '/summary?month=2026-09');
    expect(summary.data).toMatchObject({
      transactions: { open: 1, matched: 3, ignored: 1 },
      receipts: { open: 0, matched: 3, ignored: 0 },
      proposals: 0,
    });
    expect(summary.data.months).toContain('2026-09');

    // The month's export: the CSV, each receipt under Ausgaben, the Factur-X XML beside its PDF.
    const exported = await http.send('GET', '/export?month=2026-09');
    expect(exported.status).toBe(200);
    expect(exported.headers.get('content-disposition')).toContain('Ava-Belege_FIN_2026-09.zip');
    const files = readExportZip(new Uint8Array(await exported.arrayBuffer()));
    const names = Object.keys(files).sort();
    expect(names).toContain('2026-09/Buchungen_2026-09.csv');
    expect(names).toContain(
      '2026-09/Ausgaben/2026-09-20_Muster-Software-GmbH_172,50EUR_MS-10023.pdf',
    );
    expect(names).toContain(
      '2026-09/Ausgaben/2026-09-20_Muster-Software-GmbH_172,50EUR_MS-10023.xml',
    );
    expect(names.filter((name) => name.startsWith('2026-09/Ausgaben/')).length).toBe(4);
    const bookings = new TextDecoder().decode(files['2026-09/Buchungen_2026-09.csv']);
    expect(bookings).toContain('kein Beleg nötig');
    expect(bookings).toContain(';KI;0,95;');
    expect(bookings.split('\r\n').filter(Boolean)).toHaveLength(6);

    // Deleting the savings account takes its transactions along.
    await http.send('DELETE', `/accounts/${savings.data.id}`);
    const left = await http.call<{ transactions: TransactionView[] }>('GET', '/transactions');
    expect(left.data.transactions).toHaveLength(3);
  }, 60_000);

  it('takes the attachments of an invoice mail as receipts without copying them', async () => {
    const project = await getProjectByKey('FIN');
    if (!project) throw new Error('no project');
    const { accountId, inboxId } = await insertMailAccount(project.teamId, project.id);
    const text = makePdf([
      'Stadtwerke Musterstadt GmbH',
      'Rechnung Nr. SW-2026-0042',
      'Rechnungsdatum: 05.09.2026',
      'Rechnungsbetrag 89,90 EUR',
    ]);
    const mail = await insertMessage({
      teamId: project.teamId,
      accountId,
      folderId: inboxId,
      projectId: project.id,
      projectKey: 'FIN',
      subject: 'Ihre Rechnung',
      attachments: [
        { filename: 'rechnung.pdf', content: text },
        { filename: 'logo.png', content: 'not a receipt' },
      ],
    });
    const ids = await intakeMailReceipts({
      teamId: project.teamId,
      projectId: project.id,
      messageId: mail.messageRowId,
      actorUserId: owner.userId,
    });
    expect(ids).toHaveLength(1);
    const receipt = await http.call<ReceiptDetailView>('GET', `/${ids[0]}`);
    expect(receipt.data).toMatchObject({
      source: 'mail',
      extraction: 'text',
      invoiceNumber: 'SW-2026-0042',
      invoiceDate: '2026-09-05',
      totalGrossCents: 8990,
      status: 'open',
    });
    expect(receipt.data.vaultPath).toEndWith('/rechnung.pdf');
    // A receipt points at the mail file. Moving the mail must not break that reference.
    const move = await authedApi(owner.cookie).mail.threads({ threadId: mail.threadId }).patch({
      projectId: null,
    });
    expect(move.status).toBe(409);
    expect((await http.call<ReceiptDetailView>('GET', `/${ids[0]}`)).data.vaultPath).toBe(
      receipt.data.vaultPath,
    );
    // A suggested project cannot take a receipt while the file still lives in Home.
    const unfiled = await insertMessage({
      teamId: project.teamId,
      accountId,
      folderId: inboxId,
      subject: 'Unfiled invoice',
      attachments: [{ filename: 'unfiled.pdf', content: text }],
    });
    expect(
      intakeMailReceipts({
        teamId: project.teamId,
        projectId: project.id,
        messageId: unfiled.messageRowId,
        actorUserId: owner.userId,
      }),
    ).rejects.toThrow('Move the mail to this project');
    // The same mail again adds nothing.
    expect(
      await intakeMailReceipts({
        teamId: project.teamId,
        projectId: project.id,
        messageId: mail.messageRowId,
        actorUserId: owner.userId,
      }),
    ).toEqual(ids);
  }, 30_000);

  it('archives a text receipt as the exact original email once, including concurrent retries and export', async () => {
    const project = (await getProjectByKey('FIN'))!;
    const { accountId, inboxId } = await insertMailAccount(project.teamId, project.id);
    const raw =
      'From: Supplier <invoice@example.com>\r\nSubject: Payment receipt\r\nDate: Sat, 5 Sep 2026 12:00:00 +0000\r\n\r\nInvoice number: R-42\r\nAmount paid: 12.00 EUR\r\n';
    const mail = await insertMessage({
      teamId: project.teamId,
      accountId,
      folderId: inboxId,
      projectId: project.id,
      projectKey: 'FIN',
      subject: 'Payment receipt',
      fromName: 'Supplier',
      sentAt: new Date('2026-09-05'),
      text: 'Invoice number: R-42\nAmount paid: 12.00 EUR',
      raw,
    });
    const input = {
      teamId: project.teamId,
      projectId: project.id,
      messageId: mail.messageRowId,
      actorUserId: owner.userId,
    };
    const manifest = [
      {
        messageId: mail.messageRowId,
        accountId,
        projectKey: 'FIN',
        attachmentIds: [],
        includeBody: true,
      },
    ];
    const reviewed = await backfillMailReceipts(manifest);
    expect(reviewed).toMatchObject({
      mode: 'dry-run',
      new: 1,
      originals: 1,
    });
    expect((await http.call<{ receipts: ReceiptView[] }>('GET', '')).data.receipts).toHaveLength(0);
    const results = await intakeDeadline(
      Promise.all(Array.from({ length: 10 }, () => intakeMailReceipts(input))),
    );
    const first = results[0]!;
    expect(results.every((ids) => ids.length === 1 && ids[0] === first[0])).toBe(true);
    const receipt = (await http.call<ReceiptDetailView>('GET', `/${first[0]}`)).data;
    expect(receipt).toMatchObject({
      source: 'mail',
      mailAttachmentId: null,
      totalGrossCents: 1200,
      invoiceNumber: 'R-42',
      sourceLinks: { messageId: mail.messageRowId, threadId: mail.threadId, issues: [] },
    });
    expect(readFileSync(absoluteVaultPath(receipt.vaultPath), 'utf8')).toBe(raw);
    expect(
      (await readdir(absoluteVaultPath('Projects/FIN/Files/Belege/2026-09'))).filter((name) =>
        name.endsWith('.eml'),
      ),
    ).toHaveLength(1);
    expect(await backfillMailReceipts(manifest, true, reviewed)).toMatchObject({
      new: 0,
      existing: 1,
    });
    expect((await http.call<ReceiptDetailView>('POST', `/${first[0]}/extract`)).data).toMatchObject(
      { totalGrossCents: 1200 },
    );
    expect(
      (
        await authedApi(owner.cookie)
          .mail.threads({ threadId: mail.threadId })
          .patch({ projectId: null })
      ).status,
    ).toBe(409);
    const exported = await http.send('GET', '/export?month=2026-09');
    const files = readExportZip(new Uint8Array(await exported.arrayBuffer()));
    expect(
      Object.entries(files).some(
        ([name, bytes]) => name.endsWith('.eml') && new TextDecoder().decode(bytes) === raw,
      ),
    ).toBe(true);
  }, 30_000);

  it('files ten independent project originals concurrently without waiting for another pool connection', async () => {
    const asOwner = authedApi(owner.cookie);
    const inputs = [];
    for (let i = 0; i < 10; i++) {
      const target = (await asOwner.projects.post({ key: `INTAKE${i}`, name: `Intake ${i}` }))
        .data!;
      const { accountId, inboxId } = await insertMailAccount(
        target.teamId,
        target.id,
        `intake${i}@example.test`,
      );
      const mail = await insertMessage({
        teamId: target.teamId,
        accountId,
        folderId: inboxId,
        projectId: target.id,
        subject: 'Payment receipt',
        text: `Amount paid: ${14 + i}.00 EUR`,
        sentAt: new Date('2026-09-05'),
      });
      inputs.push({
        key: target.key,
        teamId: target.teamId,
        projectId: target.id,
        messageId: mail.messageRowId,
        actorUserId: owner.userId,
        skipMatching: true,
      });
    }
    const results = await intakeDeadline(
      Promise.all(inputs.map((input) => intakeMailReceipts(input))),
    );
    expect(new Set(results.flat()).size).toBe(10);
    for (let i = 0; i < inputs.length; i++) {
      const receipts = await asOwner.projects({ projectKey: inputs[i]!.key }).receipts.get();
      expect(receipts.status).toBe(200);
      expect(receipts.data!.receipts).toHaveLength(1);
      expect(receipts.data!.receipts[0]!.id).toBe(results[i]![0]);
    }
  });

  it('matches one newly committed original once across ten concurrent intakes', async () => {
    const project = (await getProjectByKey('FIN'))!;
    const bank = await http.call<AccountView>('POST', '/accounts', { name: 'Giro', iban: OWN });
    expect(
      (
        await http.upload<ImportResult>(
          `/accounts/${bank.data.id}/imports`,
          'camt.xml',
          CAMT,
          'application/xml',
        )
      ).status,
    ).toBe(201);
    const { accountId, inboxId } = await insertMailAccount(project.teamId, project.id);
    const mail = await insertMessage({
      teamId: project.teamId,
      accountId,
      folderId: inboxId,
      projectId: project.id,
      projectKey: 'FIN',
      subject: 'Hosting invoice',
      attachments: [
        {
          filename: 'invoice.xml',
          content: ublInvoice({
            id: 'H-2026-09',
            issue: '2026-09-01',
            due: '2026-09-15',
            gross: '59.00',
            net: '49.58',
          }),
        },
      ],
    });
    const input = {
      teamId: project.teamId,
      projectId: project.id,
      messageId: mail.messageRowId,
      actorUserId: owner.userId,
    };
    const decide = fakeDecider('Hosting September', 0.95, true);
    let decisions = 0;
    useReceiptDecider(async (request) => {
      decisions++;
      return decide(request);
    });
    const results = await intakeDeadline(
      Promise.all(Array.from({ length: 10 }, () => intakeMailReceipts(input))),
    );
    expect(results.every((ids) => ids.length === 1 && ids[0] === results[0]![0])).toBe(true);
    expect((await http.call<{ receipts: ReceiptView[] }>('GET', '')).data.receipts).toHaveLength(1);
    expect(decisions).toBe(1);
    expect((await http.call<ReceiptDetailView>('GET', `/${results[0]![0]}`)).data.status).toBe(
      'matched',
    );
    await intakeMailReceipts(input);
    expect(decisions).toBe(1);
  });

  it('rejects extraction failures before committing receipt rows', async () => {
    const project = (await getProjectByKey('FIN'))!;
    const { accountId, inboxId } = await insertMailAccount(project.teamId, project.id);
    const mail = await insertMessage({
      teamId: project.teamId,
      accountId,
      folderId: inboxId,
      projectId: project.id,
      projectKey: 'FIN',
      subject: 'Invoice',
      attachments: [{ filename: 'invoice.xml', content: '<not-an-invoice/>' }],
    });
    await expect(
      intakeMailReceipts({
        teamId: project.teamId,
        projectId: project.id,
        messageId: mail.messageRowId,
        actorUserId: owner.userId,
      }),
    ).rejects.toThrow('could not be extracted');
    expect((await http.call<{ receipts: ReceiptView[] }>('GET', '')).data.receipts).toHaveLength(0);
  });

  it('rolls back earlier receipt inserts when a later original fails SQL', async () => {
    const project = (await getProjectByKey('FIN'))!;
    const { accountId, inboxId } = await insertMailAccount(project.teamId, project.id);
    const mail = await insertMessage({
      teamId: project.teamId,
      accountId,
      folderId: inboxId,
      projectId: project.id,
      projectKey: 'FIN',
      subject: 'Two invoices',
      attachments: ['ONE', 'TWO'].map((id) => ({
        filename: `invoice-${id}.xml`,
        content: ublInvoice({
          id,
          issue: '2026-09-05',
          due: '2026-09-15',
          gross: '59.00',
          net: '49.58',
        }),
      })),
    });
    const input = {
      teamId: project.teamId,
      projectId: project.id,
      messageId: mail.messageRowId,
      actorUserId: owner.userId,
      skipMatching: true,
    };
    const restore = await intakeFailure(
      'helena_receipt',
      'EXISTS (SELECT 1 FROM helena_receipt WHERE project_id = NEW.project_id)',
    );
    try {
      await expect(intakeDeadline(intakeMailReceipts(input))).rejects.toThrow();
      expect((await http.call<{ receipts: ReceiptView[] }>('GET', '')).data.receipts).toHaveLength(
        0,
      );
    } finally {
      await restore();
    }
    expect(await intakeDeadline(intakeMailReceipts(input))).toHaveLength(2);
    expect((await http.call<{ receipts: ReceiptView[] }>('GET', '')).data.receipts).toHaveLength(2);
  });

  it('reuses the exact canonical email after SQL failure and rejects a changed leftover', async () => {
    // resetDb leaves earlier tests' vault files intact; isolate the original directory too.
    const created = await authedApi(owner.cookie).projects.post({
      key: 'INTAKEFS',
      name: 'Canonical receipt retry',
    });
    expect(created.status).toBe(201);
    const project = created.data!;
    const http = client(owner, project.key);
    const { accountId, inboxId } = await insertMailAccount(project.teamId, project.id);
    const raw = 'Subject: Payment receipt\r\n\r\nAmount paid: 14.00 EUR\r\n';
    const mail = await insertMessage({
      teamId: project.teamId,
      accountId,
      folderId: inboxId,
      projectId: project.id,
      subject: 'Payment receipt',
      text: 'Amount paid: 14.00 EUR',
      raw,
      sentAt: new Date('2026-09-05'),
    });
    const input = {
      teamId: project.teamId,
      projectId: project.id,
      messageId: mail.messageRowId,
      actorUserId: owner.userId,
      skipMatching: true,
    };
    const restore = await intakeFailure('helena_receipt', 'TRUE');
    try {
      await expect(intakeMailReceipts(input)).rejects.toThrow();
      expect((await http.call<{ receipts: ReceiptView[] }>('GET', '')).data.receipts).toHaveLength(
        0,
      );
    } finally {
      await restore();
    }
    const folder = `Projects/${project.key}/Files/Belege/2026-09`;
    const files = (await readdir(absoluteVaultPath(folder))).filter((name) =>
      name.endsWith('.eml'),
    );
    expect(files).toHaveLength(1);
    const canonical = `${folder}/${files[0]}`;
    expect(readFileSync(absoluteVaultPath(canonical), 'utf8')).toBe(raw);
    await writeFile(absoluteVaultPath(canonical), 'changed original');
    await expect(intakeMailReceipts(input)).rejects.toThrow('archived original changed');
    expect((await http.call<{ receipts: ReceiptView[] }>('GET', '')).data.receipts).toHaveLength(0);
    await writeFile(absoluteVaultPath(canonical), raw);
    const ids = await intakeMailReceipts(input);
    expect(ids).toHaveLength(1);
    expect(
      (await readdir(absoluteVaultPath(folder))).filter((name) => name.endsWith('.eml')),
    ).toEqual(files);
    expect((await http.call<ReceiptDetailView>('GET', `/${ids[0]}`)).data.vaultPath).toBe(
      canonical,
    );
  });

  it('rejects postcommit index failure and repairs the committed existing email on retry', async () => {
    const project = (await getProjectByKey('FIN'))!;
    const { accountId, inboxId } = await insertMailAccount(project.teamId, project.id);
    const mail = await insertMessage({
      teamId: project.teamId,
      accountId,
      folderId: inboxId,
      projectId: project.id,
      subject: 'Payment receipt',
      text: 'Amount paid: 14.00 EUR',
      sentAt: new Date('2026-09-05'),
    });
    const input = {
      teamId: project.teamId,
      projectId: project.id,
      messageId: mail.messageRowId,
      actorUserId: owner.userId,
      skipMatching: true,
    };
    await db.insert(helenaMailClassification).values({
      teamId: project.teamId,
      threadId: mail.threadId,
      messageId: mail.messageRowId,
      status: 'classified',
      category: 'invoice',
      projectId: project.id,
      actions: [
        {
          kind: 'receipt',
          receiptIds: [],
          projectId: project.id,
          note: 'No supported receipt original found.',
        },
      ],
    });
    const config = mailTriageConfig({ receipts: 'auto', accountIds: [accountId] });
    useReceiptIntake(intakeMailReceipts);
    const retry = () => retryReceiptFiling(project.teamId, config, owner.userId, project.id);
    const restore = await intakeFailure('vault_entry', "NEW.path LIKE '%.eml'");
    let original!: ReceiptView;
    try {
      expect(await retry()).toEqual({ completed: 0, failed: 1, receiptIds: [] });
      const receipts = (await http.call<{ receipts: ReceiptView[] }>('GET', '')).data.receipts;
      expect(receipts).toHaveLength(1);
      original = receipts[0]!;
      const detail = (await http.call<ReceiptDetailView>('GET', `/${original.id}`)).data;
      expect(await findEntry(detail.vaultPath)).toBeNull();
    } finally {
      await restore();
    }
    expect(await retry()).toEqual({ completed: 1, failed: 0, receiptIds: [original.id] });
    expect(await intakeMailReceipts(input)).toEqual([original.id]);
    const detail = (await http.call<ReceiptDetailView>('GET', `/${original.id}`)).data;
    expect(await findEntry(detail.vaultPath)).toMatchObject({
      sha256: createHash('sha256')
        .update(readFileSync(absoluteVaultPath(detail.vaultPath)))
        .digest('hex'),
    });
    expect((await http.call<{ receipts: ReceiptView[] }>('GET', '')).data.receipts).toHaveLength(1);
  });

  it('selects receipt originals, rejects changed files and prevents cross-project backfills', async () => {
    const project = (await getProjectByKey('FIN'))!;
    const { accountId, inboxId } = await insertMailAccount(project.teamId, project.id);
    const invoice = makePdf(['Supplier GmbH', 'Invoice number: INV-42', 'Amount due 20.00 EUR']);
    const mail = await insertMessage({
      teamId: project.teamId,
      accountId,
      folderId: inboxId,
      projectId: project.id,
      projectKey: 'FIN',
      subject: 'Invoice with contract',
      attachments: [
        { filename: 'invoice.pdf', content: invoice },
        { filename: 'contract.pdf', content: makePdf(['A contract']) },
      ],
    });
    const input = {
      teamId: project.teamId,
      projectId: project.id,
      messageId: mail.messageRowId,
      actorUserId: owner.userId,
    };
    const plans = await prepareMailReceipts(input);
    expect(plans).toHaveLength(1);
    expect(plans[0]!.filename).toBe('invoice.pdf');
    await expect(prepareMailReceipts({ ...input, attachmentIds: [999999] })).rejects.toThrow(
      'does not belong',
    );
    await expect(
      backfillMailReceipts([
        {
          messageId: mail.messageRowId,
          accountId,
          projectKey: 'OTHER',
          attachmentIds: [],
          includeBody: true,
        },
      ]),
    ).rejects.toThrow('Source scope changed');
    await writeFile(absoluteVaultPath(plans[0]!.vaultPath!), 'changed');
    await expect(intakeMailReceipts(input)).rejects.toThrow('changed after import');
    expect((await http.call<{ receipts: ReceiptView[] }>('GET', '')).data.receipts).toHaveLength(0);
  });

  it('grants finance agents receipt reads in their own project while refusing writes and other roles', async () => {
    const api = authedApi(owner.cookie);
    const receipt = await http.upload<ReceiptDetailView>(
      '',
      'finance.xml',
      ublInvoice({
        id: 'ROLE-1',
        issue: '2026-09-01',
        due: '2026-09-15',
        gross: '59.00',
        net: '49.58',
      }),
      'application/xml',
    );
    expect(receipt.status).toBe(201);
    const finance = (
      await createAgent(api, 'FIN', {
        name: 'Finance',
        username: 'finance-agent',
        kind: 'external',
      })
    ).data!;
    const coder = (
      await createAgent(api, 'FIN', { name: 'Coder', username: 'coder-agent', kind: 'external' })
    ).data!;
    const financeApi = apiKeyApi(finance.apiKey!);
    expect((await financeApi.projects({ projectKey: 'FIN' }).receipts.get()).status).toBe(200);
    expect(
      (
        await financeApi
          .projects({ projectKey: 'FIN' })
          .receipts({ receiptId: receipt.data.id })
          .get()
      ).data,
    ).toMatchObject({ id: receipt.data.id });
    expect(
      (
        await financeApi
          .projects({ projectKey: 'FIN' })
          .receipts({ receiptId: receipt.data.id })
          .patch({ status: 'ignored' })
      ).status,
    ).toBe(403);
    expect(
      (await apiKeyApi(coder.apiKey!).projects({ projectKey: 'FIN' }).receipts.get()).status,
    ).toBe(403);
    await api.projects.post({ key: 'OUT', name: 'Outside' });
    expect((await financeApi.projects({ projectKey: 'OUT' }).receipts.get()).status).toBe(403);
    expect((await financeApi.projects({ projectKey: 'FIN' }).receipts.accounts.get()).status).toBe(
      403,
    );
  });

  it('keeps receipt tools within project administrators and project boundaries', async () => {
    const stranger = await signUpTestUser();
    await authedApi(stranger.cookie).projects.post({ key: 'OTHER', name: 'Other project' });
    const denied = await client(stranger).call('GET', '/accounts');
    expect(denied.status).toBe(403);
    expect((await client(owner, 'OTHER').call('GET', '/accounts')).status).toBe(403);
    expect((await client(stranger, 'OTHER').call('GET', '/accounts')).status).toBe(200);
    const prepared = await http.call<{ downloadPath: string }>('POST', '/export/prepare', {
      month: '2026-09',
    });
    expect(prepared.status).toBe(200);
    expect(prepared.data.downloadPath).toBe('/projects/FIN/receipts/export?month=2026-09');
    const receiptRoutes = (route: string) => route.includes('/projects/:projectKey/receipts');
    const all = app.routes.filter((route) => receiptRoutes(`${route.method} ${route.path}`));
    expect(all.length).toBeGreaterThan(20);
    expect(untaggedRoutes(receiptRoutes)).toHaveLength(4);
    for (const tool of routeTools(app).filter((tool) => receiptRoutes(tool.path))) {
      expect(tool.permission).toEqual(
        ['list_receipts', 'read_receipt'].includes(tool.name)
          ? ['receipts', 'read']
          : ['project_admin', 'admin'],
      );
    }
  });
});
