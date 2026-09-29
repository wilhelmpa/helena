import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { act } from 'react';
import { withDom } from '../../../../test/dom';

// A pinned file stays open when the page changes (Auftrag 117): the Shell brings it back on
// any page from the pin alone, and steps back where the Wissen page shows it itself.
const { mock } = createRequire(import.meta.url)('bun:test') as {
  mock: { module(specifier: string, factory: () => Record<string, unknown>): void };
};
mock.module('next/navigation', () => ({ useRouter: () => ({ push: () => undefined }) }));
mock.module('./KnowledgePreview', () => ({
  default: ({ entry, pinnedHost }: { entry: { item: { name: string } }; pinnedHost?: boolean }) => (
    <aside data-preview={entry.item.name} data-host={pinnedHost ? 'shell' : 'page'} />
  ),
}));

// Loaded before a window exists: the API client reads its address when it is imported.
const { default: PinnedKnowledgePreview } = await import('./PinnedKnowledgePreview');

test('the pinned file is shown on another page and not twice on its own', async () => {
  await withDom('https://ava.example/project/VOL/files?path=Docs', async () => {
    const pins = await import('@/utils/overlayPin');
    pins.resetOverlayPinForTest();
    const { createRoot } = await import('react-dom/client');
    const root = createRoot(document.querySelector('#root')!);
    const entry = {
      key: 'vault:Docs/Plan.md',
      item: { name: 'Plan.md', path: 'Docs/Plan.md', kind: 'file' },
      scope: { kind: 'project', projectKey: 'VOL', root: 'vault' },
      vaultPath: 'Projects/VOL/Docs/Plan.md',
    };
    function PageShowsIt() {
      pins.useOverlayShownHere({ kind: 'file', value: entry.key });
      return null;
    }
    try {
      await act(async () => root.render(<PinnedKnowledgePreview />));
      assert.equal(document.querySelector('[data-preview]'), null);
      pins.pinOverlay({
        kind: 'file',
        value: entry.key,
        data: JSON.stringify({ entry, can: { edit: true, delete: true, create: true } }),
      });
      // Another page (the Shell of Aufgaben): the file is there.
      await act(async () => root.render(<PinnedKnowledgePreview />));
      assert.equal(document.querySelector('[data-preview]')?.getAttribute('data-host'), 'shell');
      // Back on the Wissen page that shows it: only once.
      await act(async () =>
        root.render(
          <>
            <PageShowsIt />
            <PinnedKnowledgePreview />
          </>,
        ),
      );
      assert.equal(document.querySelector('[data-preview]'), null);
      pins.unpinOverlay();
      await act(async () => root.render(<PinnedKnowledgePreview />));
      assert.equal(document.querySelector('[data-preview]'), null);
    } finally {
      await act(async () => root.unmount());
    }
  });
});
