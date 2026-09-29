import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { act } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import files from '../../../../messages/en/files.json';
import { withDom } from '../../../../test/dom';

// An office file is shown by the server's own converter (Auftrag 127): a document as its
// pages, a spreadsheet as its sheets — and when the converter cannot, the reason in words.
const { default: FileViewerOffice } = await import('./FileViewerOffice');
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const docx = {
  name: 'Angebot.docx',
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  sizeBytes: 867,
  url: '/protected-media/files?path=Angebot.docx',
  vaultPath: 'Projects/VOL/Files/Angebot.docx',
};
const meta = (extra: object = {}) => ({
  path: docx.vaultPath,
  kind: 'office',
  mime: docx.contentType,
  sizeBytes: 867,
  sha256: 'abc',
  pdfUrl: '/knowledge/preview/file?path=x',
  ...extra,
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function mount(node: React.ReactNode) {
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.querySelector('#root')!);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <NextIntlClientProvider locale="en" timeZone="UTC" messages={{ files }}>
          {node}
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
  });
  // let the queries settle
  for (let i = 0; i < 8; i++)
    await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
  return root;
}

test('a converted document is shown as its pages', async () => {
  await withDom('https://ava.example/', async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/knowledge/preview/file')) return new Response('%PDF-1.4');
      return json(meta());
    }) as typeof fetch;
    const root = await mount(<FileViewerOffice file={docx} />);
    try {
      const frame = document.querySelector<HTMLIFrameElement>('iframe.ds-file-embed');
      assert.ok(frame, 'the pages are in a frame');
      assert.match(
        frame.getAttribute('src') ?? '',
        /^\/protected-media\/knowledge\/preview\/file\?path=/,
      );
    } finally {
      await act(async () => root.unmount());
    }
  });
});

test('a spreadsheet is shown as its sheets, its pages one click away', async () => {
  await withDom('https://ava.example/', async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/knowledge/preview/table'))
        return json({
          path: 'x',
          sha256: 'abc',
          sheets: [
            {
              name: 'Zahlen',
              rows: [
                ['Name', 'Wert'],
                ['Preview', '42'],
              ],
              truncated: false,
            },
          ],
        });
      return json(meta({ tableUrl: '/knowledge/preview/table?path=x' }));
    }) as typeof fetch;
    const root = await mount(<FileViewerOffice file={docx} />);
    try {
      assert.deepEqual(
        [...document.querySelectorAll('th')].map((cell) => cell.textContent),
        ['Name', 'Wert'],
      );
      assert.ok(document.body.textContent?.includes(files.viewer.pages));
    } finally {
      await act(async () => root.unmount());
    }
  });
});

for (const [status, reason] of [
  [413, files.viewer.problems.tooLarge],
  [422, files.viewer.problems.damaged],
  [504, files.viewer.problems.timeout],
  [503, files.viewer.problems.unavailable],
] as const) {
  test(`the converter answering ${status} says why, and the download stays`, async () => {
    await withDom('https://ava.example/', async () => {
      globalThis.fetch = (async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes('/knowledge/preview/file')) return json({ error: 'no' }, status);
        if (url.includes('/knowledge/documents')) return new Response(null, { status: 404 });
        return json(meta());
      }) as typeof fetch;
      const root = await mount(<FileViewerOffice file={docx} />);
      try {
        assert.ok(document.body.textContent?.includes(reason), `shows: ${reason}`);
        assert.equal(document.querySelector('iframe'), null);
        assert.equal(
          document.querySelector<HTMLAnchorElement>('a[download]')?.getAttribute('href'),
          docx.url,
        );
      } finally {
        await act(async () => root.unmount());
      }
    });
  });
}
