import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import files from '../../../../messages/en/files.json';
import { withDom } from '../../../../test/dom';

// The viewers of a file (O76): a spreadsheet's sheets or a CSV as a table, a file that
// cannot be shown as its symbol, name and the way to download it.
const { default: SheetView, SHEET_MAX_ROWS } = await import('./SheetView');
const { default: FileViewerFallback } = await import('./FileViewerFallback');

async function render(node: React.ReactNode) {
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.querySelector('#root')!);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" timeZone="UTC" messages={{ files }}>
        {node}
      </NextIntlClientProvider>,
    );
  });
  return root;
}

test('a sheet shows its first row as the head and every other row as a row', async () => {
  await withDom('https://ava.example/', async () => {
    const root = await render(
      <SheetView
        sheets={[
          {
            name: 'Preise',
            rows: [
              ['Name', 'Anzahl'],
              ['Seite', '3'],
              ['Bild', '10'],
            ],
          },
        ]}
      />,
    );
    try {
      assert.deepEqual(
        [...document.querySelectorAll('th')].map((cell) => cell.textContent),
        ['Name', 'Anzahl'],
      );
      assert.equal(document.querySelectorAll('tbody tr').length, 2);
      // One sheet needs no tabs.
      assert.equal(document.querySelector('[role="radiogroup"], [role="tablist"]'), null);
    } finally {
      await act(async () => root.unmount());
    }
  });
});

test('several sheets get a switch, and a long table says it is cut', async () => {
  await withDom('https://ava.example/', async () => {
    const long = [['a'], ...Array.from({ length: SHEET_MAX_ROWS + 20 }, (_, i) => [String(i)])];
    const root = await render(
      <SheetView
        sheets={[
          { name: 'Erstes', rows: [['x'], ['1']] },
          { name: 'Zweites', rows: long },
        ]}
      />,
    );
    try {
      assert.ok(document.body.textContent?.includes('Erstes'));
      assert.ok(document.body.textContent?.includes('Zweites'));
      const second = [...document.querySelectorAll<HTMLElement>('button, [role="radio"]')].find(
        (node) => node.textContent === 'Zweites',
      )!;
      await act(async () => second.click());
      assert.equal(document.querySelectorAll('tbody tr').length, SHEET_MAX_ROWS);
      assert.ok(document.body.textContent?.includes(`first ${SHEET_MAX_ROWS} rows`));
    } finally {
      await act(async () => root.unmount());
    }
  });
});

test('an empty table and a file without a preview never leave an empty box', async () => {
  await withDom('https://ava.example/', async () => {
    const root = await render(<SheetView sheets={[{ name: 'Leer', rows: [] }]} />);
    try {
      assert.ok(document.body.textContent?.includes(files.viewer.sheetEmpty));
    } finally {
      await act(async () => root.unmount());
    }
    const other = await render(
      <FileViewerFallback
        name="daten.bin"
        contentType="application/octet-stream"
        sizeBytes={2048}
        url="/raw/daten.bin"
      />,
    );
    try {
      assert.ok(document.body.textContent?.includes('daten.bin'));
      assert.ok(document.body.textContent?.includes(files.viewer.noPreview));
      const download = document.querySelector<HTMLAnchorElement>('a[download]')!;
      assert.equal(download.getAttribute('href'), '/raw/daten.bin');
      assert.equal(download.textContent?.trim(), files.viewer.download);
    } finally {
      await act(async () => other.unmount());
    }
  });
});
