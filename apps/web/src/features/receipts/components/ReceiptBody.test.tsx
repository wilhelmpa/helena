import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { JSDOM } from 'jsdom';
import type { ReceiptDetail } from '@/lib/api/endpoints/receipts';
import receipts from '../../../../messages/de/receipts.json';
import common from '../../../../messages/de/common.json';
import ReceiptBody from './ReceiptBody';
import ReceiptOriginalMailView from './ReceiptOriginalMailView';

const receipt: ReceiptDetail = {
  id: 91,
  source: 'mail',
  filename: 'invoice.xml',
  contentType: 'application/xml',
  size: 800,
  vaultPath: 'Projects/FIN/Files/Mail/2026-09/invoice.xml',
  issuer: 'Supplier',
  invoiceNumber: 'R-42',
  invoiceDate: '2026-09-26',
  dueDate: null,
  totalGrossCents: 1200,
  vatCents: null,
  currency: 'EUR',
  iban: null,
  direction: 'incoming',
  extraction: 'xrechnung',
  extractionError: null,
  status: 'open',
  creditNote: false,
  directDebit: false,
  einvoice: true,
  paymentReference: null,
  createdAt: '2026-09-26T12:00:00Z',
  match: null,
  proposals: 0,
  textExcerpt: null,
  details: {},
  mailAttachmentId: 335,
  sourceLinks: {
    messageId: 7235,
    threadId: 6951,
    issues: [{ id: 812, projectKey: 'FIN', sequenceNumber: 15, identifier: 'FIN-15' }],
  },
};

function render(value: ReceiptDetail, projectKey = 'FIN') {
  const client = new QueryClient();
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="de" timeZone="UTC" messages={{ receipts, common }}>
        <ReceiptBody projectKey={projectKey} receipt={value} onDeleted={() => {}} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  client.clear();
  const dom = new JSDOM(html);
  const links = [...dom.window.document.querySelectorAll('a')].map((a) => ({
    href: a.getAttribute('href'),
    text: a.textContent,
    target: a.getAttribute('target'),
  }));
  const text = dom.window.document.body.textContent;
  dom.window.close();
  return { links, text };
}

describe('receipt detail source navigation', () => {
  it('renders the source mail and actual task sequence beside the unchanged canonical file link', () => {
    const view = render(receipt);
    assert.ok(
      view.links.some(
        (a) =>
          a.href === '/project/FIN/inbox?thread=6951' &&
          a.text === 'Quellmail öffnen' &&
          a.target === null,
      ),
    );
    assert.ok(
      view.links.some((a) => a.href === '/project/FIN/issue/15' && a.text === 'Aufgabe FIN-15'),
    );
    assert.ok(!view.links.some((a) => a.href?.includes('/issue/812')));
    const files = view.links.find((a) => a.text === 'In Wissen zeigen');
    assert.ok(files?.href);
    const url = new URL(files.href, 'https://helena.test');
    assert.equal(url.pathname, '/project/FIN/files');
    assert.equal(url.searchParams.get('file'), 'Files/Mail/2026-09/invoice.xml');
    assert.ok(view.text?.includes('Datei öffnen'));
  });

  it('keeps an unavailable source readable and leaves the original file reachable', () => {
    const view = render({ ...receipt, sourceLinks: null });
    assert.ok(view.text?.includes(receipts.detail.sourceUnavailable));
    assert.ok(!view.links.some((a) => a.href?.includes('/inbox') || a.href?.includes('/issue/')));
    assert.ok(view.links.some((a) => a.text === 'In Wissen zeigen'));
  });

  it('renders an EML source without inventing a task and uses the current numeric thread', () => {
    const view = render({
      ...receipt,
      mailAttachmentId: null,
      filename: 'original.eml',
      contentType: 'message/rfc822',
      vaultPath: 'Projects/FIN/Files/Belege/2026-09/original.eml',
      sourceLinks: { messageId: 7206, threadId: 6931, issues: [] },
    });
    assert.ok(view.links.some((a) => a.href === '/project/FIN/inbox?thread=6931'));
    assert.ok(!view.links.some((a) => a.href?.includes('/issue/')));
    assert.ok(view.links.some((a) => a.href?.includes('Files%2FBelege%2F2026-09%2Foriginal.eml')));
  });

  it('does not offer mail navigation for an uploaded receipt', () => {
    const view = render({ ...receipt, source: 'upload', sourceLinks: null });
    assert.ok(!view.text?.includes(receipts.detail.sourceUnavailable));
    assert.ok(!view.links.some((a) => a.href?.includes('/inbox') || a.href?.includes('/issue/')));
  });
  it('opens archived sources in a receipt-only dialog instead of navigating to their thread', () => {
    const view = render({ ...receipt, sourceLinks: { ...receipt.sourceLinks!, archived: true } });
    assert.ok(view.text?.includes(receipts.detail.sourceArchivedMail));
    assert.ok(!view.links.some((link) => link.href?.includes('/inbox')));
    assert.ok(view.links.some((link) => link.text === 'In Wissen zeigen'));
  });
  it('renders untrusted original text without resources, links or mail actions', () => {
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="de" timeZone="UTC" messages={{ receipts }}>
        <ReceiptOriginalMailView
          mail={{
            messageId: 1,
            archived: true,
            subject: '<script>alert(1)</script>',
            fromName: 'Supplier',
            fromAddress: 'sender@example.test',
            sentAt: '2026-09-27T00:00:00Z',
            text: '<img src="https://external.invalid/pixel"> Plain original',
            htmlText: '<a href="https://external.invalid">Alternative original</a>',
          }}
        />
      </NextIntlClientProvider>,
    );
    const dom = new JSDOM(html);
    assert.equal(dom.window.document.querySelectorAll('script,img,iframe,a,form,button').length, 0);
    assert.ok(dom.window.document.body.textContent?.includes('Plain original'));
    assert.ok(dom.window.document.body.textContent?.includes('Alternative original'));
    dom.window.close();
  });
});

describe('supplementary original detail', () => {
  const originals = [
    { id: 91, filename: 'invoice.xml', size: 800, contentType: 'application/xml' },
    { id: 92, filename: 'payment.pdf', size: 900, contentType: 'application/pdf' },
  ];
  it('shows both original identities and a reversible relation on the primary receipt', () => {
    const view = render({ ...receipt, originalCount: 2, primaryReceiptId: null, originals });
    assert.ok(view.text?.includes('invoice.xml'));
    assert.ok(view.text?.includes('payment.pdf'));
    assert.ok(view.text?.includes(receipts.originals.detach));
    assert.ok(!view.text?.includes(receipts.originals.choose));
    assert.ok(view.text?.includes(receipts.detail.match));
  });
  it('keeps supplementary facts and source readable while removing its separate match controls', () => {
    const view = render({ ...receipt, id: 92, primaryReceiptId: 91, originalCount: 1, originals });
    assert.ok(view.text?.includes(receipts.originals.supplement));
    assert.ok(view.text?.includes(receipts.originals.detach));
    assert.ok(view.text?.includes('Datei öffnen'));
    assert.ok(!view.text?.includes(receipts.detail.matchAgain));
    assert.ok(!view.text?.includes(receipts.originals.choose));
  });
});
