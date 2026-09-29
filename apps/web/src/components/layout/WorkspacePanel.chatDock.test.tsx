import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { act, useState, type ComponentType } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import nav from '../../../messages/en/nav.json';
import { withDom } from '../../../test/dom';
import { useChatDock } from '@/context/chatDock';

// Another tab in front: the chat stays at hand as a bar at the bottom of the panel, the same
// mounted chat — its draft and state survive the switch — which opens into a chat area and
// remembers that on this device (Auftrag 116).

const { mock } = createRequire(import.meta.url)('bun:test') as {
  mock: { module(specifier: string, factory: () => Record<string, unknown>): void };
};

let chatMounts = 0;
function FakeChat() {
  const [draft, setDraft] = useState('');
  const [mounted] = useState(() => ++chatMounts);
  const dock = useChatDock();
  return (
    <div
      data-chat
      data-mount={mounted}
      data-docked={dock ? (dock.expanded ? 'open' : 'closed') : 'tab'}
    >
      <input aria-label="draft" value={draft} onChange={(event) => setDraft(event.target.value)} />
      {dock && (
        <button type="button" onClick={dock.onToggle}>
          toggle
        </button>
      )}
    </div>
  );
}
function FakeTerminal() {
  return <div data-terminal />;
}
const tools: { id: string; view: { kind: 'component'; component: ComponentType } }[] = [
  { id: 'chat', view: { kind: 'component', component: FakeChat } },
  { id: 'terminal', view: { kind: 'component', component: FakeTerminal } },
];
mock.module('@/extensions/panelTools', () => ({
  usePanelTools: () => tools,
  useOfferedPanelTools: () => tools,
  panelTool: (id: string) => tools.find((tool) => tool.id === id),
}));
mock.module('@/extensions/pluginPanelTools', () => ({ usePanelToolLabel: () => () => 'Tool' }));
mock.module('@/services/projects.service', () => ({
  useProjectProvisioningQuery: () => ({ data: null }),
}));
mock.module('@/hooks/useBrowserPreferences', () => ({
  useBrowserPreferences: () => ({ view: 'live', ready: false, lossless: false }),
}));
mock.module('./WorkspaceBrowserColorScheme', () => ({
  default: () => null,
  useBrowserColorScheme: () => ({ mode: 'helena', loaded: true, setMode: () => undefined }),
}));
mock.module('./WorkspaceBrowserBar', () => ({ default: () => null }));
mock.module('./WorkspaceBrowserLive', () => ({ default: () => null }));
mock.module('./WorkspaceTabBar', () => ({ default: () => <div data-tabbar /> }));
mock.module('./WorkspacePanelHeader', () => ({ default: () => <div data-header /> }));

const { default: WorkspacePanel } = await import('./WorkspacePanel');

test('the chat moves to the bar behind another tab without remounting', async () => {
  await withDom('https://ava.example/project/VOL', async () => {
    localStorage.clear();
    const { resetChatDockPreferenceForTest } = await import('@/hooks/useChatDockPreference');
    resetChatDockPreferenceForTest();
    const { createRoot } = await import('react-dom/client');
    const root = createRoot(document.querySelector('#root')!);
    const selected: string[] = [];
    const render = (tool: string) =>
      root.render(
        <NextIntlClientProvider locale="en" timeZone="UTC" messages={{ nav }}>
          <WorkspacePanel
            areas={[{ id: 'main', tool, main: true, column: 1 }]}
            contextProjectKey="VOL"
            toolSession={0}
            mode="overlay"
            overlay
            full={false}
            onToggleMode={() => undefined}
            onPickTool={() => undefined}
            onCloseArea={() => undefined}
            onClose={() => undefined}
            tabs={{} as never}
            activeTool={tool}
            layoutId="standard"
            onSelectTab={(next) => selected.push(next)}
            onCloseTab={() => undefined}
            onChooseLayout={() => undefined}
          />
        </NextIntlClientProvider>,
      );
    try {
      await act(async () => render('chat'));
      const chat = () => document.querySelector<HTMLElement>('[data-chat]')!;
      assert.equal(chat().dataset.docked, 'tab');
      const input = document.querySelector<HTMLInputElement>('[aria-label="draft"]')!;
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
        setter.call(input, 'Hallo Ava');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });

      // The terminal comes to the front: the chat is the closed bar under it.
      await act(async () => render('terminal'));
      assert.ok(document.querySelector('[data-terminal]'));
      assert.equal(chat().dataset.docked, 'closed');
      assert.equal(chat().dataset.mount, '1', 'the same chat, not a new one');
      assert.equal(chatMounts, 1);
      assert.equal(
        document.querySelector<HTMLInputElement>('[aria-label="draft"]')!.value,
        'Hallo Ava',
      );
      const dock = document.querySelector<HTMLElement>('[data-panel-part="chat-dock"]')!;
      assert.equal(dock.dataset.state, 'collapsed');
      assert.equal(dock.style.gridRow, '3');

      // Opened, it takes the height this device remembers.
      await act(async () =>
        document.querySelector<HTMLButtonElement>('[data-chat] button')!.click(),
      );
      assert.equal(chat().dataset.docked, 'open');
      assert.equal(dock.dataset.state, 'expanded');
      assert.equal(dock.style.height, '320px');
      assert.deepEqual(JSON.parse(localStorage.getItem('helena:chat-dock')!), {
        expanded: true,
        height: 320,
      });

      // Back to the chat tab: still the same chat with its draft.
      await act(async () => render('chat'));
      assert.equal(chat().dataset.docked, 'tab');
      assert.equal(chatMounts, 1);
      assert.equal(document.querySelector('[data-panel-part="chat-dock"]'), null);
    } finally {
      await act(async () => root.unmount());
    }
  });
});
