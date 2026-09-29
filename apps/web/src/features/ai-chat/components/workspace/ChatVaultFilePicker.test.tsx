import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { act, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { JSDOM } from 'jsdom';
import type { FileScope } from '@/lib/api/endpoints/projectFiles';
import chatWorkspace from '../../../../../messages/en/chatWorkspace.json';
import knowledge from '../../../../../messages/en/knowledge.json';

const { mock } = createRequire(import.meta.url)('bun:test') as {
  mock: { module(specifier: string, factory: () => Record<string, unknown>): void };
};
const listings: { scope: FileScope; path: string }[] = [];
const uploads: { scope: FileScope; path: string }[] = [];
mock.module('@/lib/api/endpoints/projectFiles', () => ({
  listFiles: async (scope: FileScope, path: string) => {
    listings.push({ scope, path });
    const next = path === '' ? 'Files' : path === 'Files' ? 'Files/proof' : 'Files/proof/Cycle.md';
    return {
      items: [
        {
          path: next,
          name: next.split('/').at(-1),
          kind: next.endsWith('.md') ? 'file' : 'folder',
        },
      ],
    };
  },
  uploadFiles: async (scope: FileScope, path: string) => {
    uploads.push({ scope, path });
    return [{ path: `${path}/uploaded.pdf`, name: 'uploaded.pdf', kind: 'file' }];
  },
}));
// The picker lists canonical knowledge refs from the server (119); the ref is what it hands on.
const searches: string[] = [];
mock.module('@/lib/api/endpoints/everything', () => ({
  listAttachableKnowledge: async (search: string) => {
    searches.push(search);
    return {
      items: [{ ref: pickerRef, title: 'Cycle.md', source: 'vault', href: pickerHref }],
    };
  },
}));
let pickerRef = '';
let pickerHref = '';
// Modal mechanics are unrelated; the real picker still fetches and selects.
mock.module('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));
const { default: ChatVaultFilePicker } = await import('./ChatVaultFilePicker');
const { default: ChatAttachmentChip } = await import('./ChatAttachmentChip');
const { useVaultUpload } = await import('../../hooks/useVaultUpload');

function UploadProbe({
  scopeKey,
  onUploaded,
}: {
  scopeKey: string;
  onUploaded: (paths: string[]) => void;
}) {
  const upload = useVaultUpload(scopeKey);
  return (
    <button
      onClick={async () =>
        onUploaded(await upload.mutateAsync([new File(['synthetic'], 'uploaded.pdf')]))
      }
    >
      Upload
    </button>
  );
}

test('real picker and upload hook hand canonical paths to the composer and its chip', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  const names = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'];
  const saved = new Map(
    names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  );
  for (const name of names)
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value:
        name === 'IS_REACT_ACT_ENVIRONMENT'
          ? true
          : (dom.window as unknown as Record<string, unknown>)[name],
    });
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.querySelector('#root')!);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const render = (child: ReactNode) =>
    act(async () =>
      root.render(
        <NextIntlClientProvider locale="en" timeZone="UTC" messages={{ chatWorkspace, knowledge }}>
          <QueryClientProvider client={qc}>{child}</QueryClientProvider>
        </NextIntlClientProvider>,
      ),
    );
  const click = async (label: string) => {
    for (let attempt = 0; attempt < 20; attempt++) {
      const button = [...document.querySelectorAll('button')].find(
        (item) => item.textContent === label,
      );
      if (button) {
        await act(async () => button.click());
        return;
      }
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
      });
    }
    assert.fail(`Missing fixture button ${label}`);
  };
  try {
    for (const [scopeKey, prefix, href] of [
      [
        'VOL',
        'Projects/VOL',
        '/project/VOL/files?path=Files%2Fproof&file=Files%2Fproof%2FCycle.md',
      ],
      ['team:1', 'Home', '/files?root=home&path=Files%2Fproof&file=Files%2Fproof%2FCycle.md'],
    ]) {
      let picked: string | undefined;
      pickerRef = `${prefix}/Files/proof/Cycle.md`;
      pickerHref = href;
      await render(
        <ChatVaultFilePicker
          key={scopeKey}
          scopeKey={scopeKey}
          onClose={() => {}}
          onPick={(path) => {
            picked = path;
          }}
        />,
      );
      await click('Cycle.md');
      assert.equal(picked, `${prefix}/Files/proof/Cycle.md`);
      assert.ok(searches.length > 0);
      const html = renderToStaticMarkup(
        <ChatAttachmentChip
          attachment={{
            kind: 'file',
            path: picked!,
            name: 'Cycle.md',
            contentType: 'text/markdown',
            sizeBytes: 10,
          }}
        />,
      );
      const chip = new JSDOM(html);
      assert.equal(chip.window.document.querySelector('a')?.getAttribute('href'), href);
      chip.window.close();
      let uploaded: string[] = [];
      await render(
        <UploadProbe
          scopeKey={scopeKey}
          onUploaded={(paths) => {
            uploaded = paths;
          }}
        />,
      );
      await click('Upload');
      assert.deepEqual(uploaded, [`${prefix}/Files/Chat/uploaded.pdf`]);
      assert.equal(uploads.at(-1)?.path, 'Files/Chat');
      assert.deepEqual(
        uploads.at(-1)?.scope,
        scopeKey === 'VOL'
          ? { kind: 'project', projectKey: 'VOL', root: 'vault' }
          : { kind: 'home', root: 'home' },
      );
    }
  } finally {
    await act(async () => root.unmount());
    await qc.cancelQueries();
    qc.clear();
    // Drain QueryClient notification tasks before restoring the DOM globals.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    dom.window.close();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
