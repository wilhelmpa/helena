import assert from 'node:assert/strict';
import { it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import receipts from '../../../../messages/de/receipts.json';
import type { Receipt } from '@/lib/api/endpoints/receipts';
import ReceiptDocument from './ReceiptDocument';

it('embeds a receipt PDF as a named frame under the existing CSP', () => {
  const client = new QueryClient();
  client.setQueryData(
    ['receipt-file', 'TEST', 211],
    new Blob(['%PDF-fixture'], { type: 'application/pdf' }),
  );
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider timeZone="UTC" locale="de" messages={{ receipts }}>
        <ReceiptDocument
          projectKey="TEST"
          receipt={{ id: 211, contentType: 'application/pdf', filename: 'fixture.pdf' } as Receipt}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  assert.match(html, /<iframe[^>]+src="blob:/);
  assert.match(html, /title="fixture.pdf"/);
  assert.doesNotMatch(html, /<object/);
  assert.match(html, /class="h-full w-full"/);
});
