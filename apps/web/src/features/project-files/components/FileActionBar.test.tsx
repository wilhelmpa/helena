import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import common from '../../../../messages/en/common.json';
import files from '../../../../messages/en/files.json';
import { withDom } from '../../../../test/dom';

// Loaded before a window exists: the API client reads its address when it is imported.
const { ShellCtx } = await import('@/context/shellContext');
const { default: FileActionBar } = await import('./FileActionBar');
const queue = await import('@/utils/chatAttachQueue');

// A file's actions stand in its overlay with their names (owner 29.09., O80): the important
// ones as buttons, the rare ones under a menu that says what it holds — and the row's menu
// draws the same list.
const item = {
  name: 'plan.md',
  path: 'Docs/plan.md',
  kind: 'file' as const,
  contentType: null,
  sizeBytes: null,
  updatedAt: null,
};
const asked: string[] = [];
const fakeActions = {
  ask: (dialog: string) => asked.push(dialog),
  projectKey: 'VOL',
  vaultPath: () => 'Projects/VOL/Docs/plan.md',
  open: () => undefined,
  downloadUrl: () => '/download/plan.md',
  codeUrl: () => 'https://code.example/?folder=/srv/plan',
  copyPath: async () => {
    asked.push('copy');
  },
};

async function mount(
  can: { create: boolean; edit: boolean; delete: boolean },
  opened: string[],
  withDialogs = true,
) {
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(document.querySelector('#root')!);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" timeZone="UTC" messages={{ common, files }}>
        <ShellCtx.Provider
          value={{ onOpenWorkspaceTool: (tool: string) => opened.push(tool) } as never}
        >
          <FileActionBar
            item={item}
            actions={fakeActions as never}
            can={can}
            withDialogs={withDialogs}
          />
        </ShellCtx.Provider>
      </NextIntlClientProvider>,
    );
  });
  return root;
}

const names = () =>
  [...document.querySelectorAll('[data-file-actions] > *')].map((node) => node.textContent?.trim());

test('the actions of a file are named buttons, the rare ones sit under a named menu', async () => {
  await withDom('https://ava.example/project/VOL/files', async () => {
    const opened: string[] = [];
    const root = await mount({ create: true, edit: true, delete: true }, opened);
    try {
      assert.deepEqual(names(), [
        files.actions.download,
        files.actions.copyLink,
        files.actions.attachToChat,
        files.actions.rename,
        files.actions.move,
        files.actions.trash,
        files.actions.moreActions,
      ]);
      // A download is an address, not a script.
      const download = document.querySelector<HTMLAnchorElement>('a[download]')!;
      assert.equal(download.getAttribute('href'), '/download/plan.md');
      // No button is nameless.
      assert.ok(
        [...document.querySelectorAll('[data-file-actions] button')].every((b) =>
          b.textContent?.trim(),
        ),
      );
    } finally {
      await act(async () => root.unmount());
    }
  });
});

test('what needs a dialog or a right is not offered without them', async () => {
  await withDom('https://ava.example/project/VOL/files', async () => {
    const opened: string[] = [];
    const root = await mount({ create: false, edit: false, delete: false }, opened);
    try {
      assert.deepEqual(names(), [
        files.actions.download,
        files.actions.copyLink,
        files.actions.attachToChat,
        files.actions.moreActions,
      ]);
    } finally {
      await act(async () => root.unmount());
    }
    const again = await mount({ create: true, edit: true, delete: true }, opened, false);
    try {
      // On a page without the dialogs (a pinned file) rename, move and trash are not there.
      assert.deepEqual(names(), [
        files.actions.download,
        files.actions.copyLink,
        files.actions.attachToChat,
        files.actions.moreActions,
      ]);
    } finally {
      await act(async () => again.unmount());
    }
  });
});

test('"Attach to chat" queues the file for the composer and shows the chat', async () => {
  await withDom('https://ava.example/project/VOL/files', async () => {
    queue.resetChatAttachQueueForTest();
    const opened: string[] = [];
    const root = await mount({ create: true, edit: true, delete: true }, opened);
    try {
      const attach = [
        ...document.querySelectorAll<HTMLButtonElement>('[data-file-actions] button'),
      ].find((button) => button.textContent?.trim() === files.actions.attachToChat)!;
      await act(async () => attach.click());
      assert.deepEqual(opened, ['chat']);
      assert.deepEqual(queue.takeQueuedChatAttachments(), [
        { path: 'Projects/VOL/Docs/plan.md', name: 'plan.md' },
      ]);
    } finally {
      await act(async () => root.unmount());
    }
  });
});
