import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, it } from 'node:test';
import { act } from 'react';
import type { Root } from 'react-dom/client';
import type { Editor } from '@tiptap/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import Link from 'next/link';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { JSDOM } from 'jsdom';
import { cleanStores } from 'nanostores';
import { WebLinksContext } from '@/context/webLinks';
import { RelativeTimeProvider } from '@/context/relativeTimeContext';
import { authClient, SessionProvider } from '@/lib/auth-client';
import { filesScopeKey } from '@/services/files.service';
import { vaultNotePath } from '@/utils/paths';
import { webLinkScope } from '@/utils/webLinkScope';
import { markdownContent, preserveMarkdownEnding } from '../utils/markdownContent';
import files from '../../../../messages/en/files.json';
import documents from '../../../../messages/en/documents.json';
import common from '../../../../messages/en/common.json';
let UnifiedFileViewer: typeof import('./UnifiedFileViewer').default;
let FileBrowser: typeof import('./FileBrowser').default;
let VaultTextEditor: typeof import('./VaultTextEditor').default;

const path = 'Docs/AI/00-Start.md';
const canonical = `Projects/RES/${path}`;
const target = 'Projects/RES/Docs/AI/01-Overview.md';
const foreign = 'Projects/OTHER/Docs/Private.md';
const scope = { kind: 'project', projectKey: 'RES', root: 'vault' } as const;
const prefix = '\uFEFF---\r\ntitle: "Research" # retain this comment\r\ntags: [ai, jev]\r\n---\r\n';
const table = '| Symbol | Trade |\n| --- | --- |\n| SPY | [[TRADE-1\\|SPY]] |\n';
const softBreak = 'First line\nSecond line';
const original = `${prefix}# Research\n\n[[${target.slice(0, -3)}|Overview]] and [[${foreign.slice(0, -3)}|Foreign]].\n\n${table}\n${softBreak}\n\n[Source](https://example.test/source)\n\n![Chart](Assets/chart.png)\n`;
const sha = (content: string) => createHash('sha256').update(content).digest('hex');
const globals = [
  'window',
  'document',
  'navigator',
  'Node',
  'Element',
  'HTMLElement',
  'HTMLAnchorElement',
  'CustomEvent',
  'NodeFilter',
  'HTMLInputElement',
  'HTMLButtonElement',
  'DOMParser',
  'MutationObserver',
  'getComputedStyle',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'IS_REACT_ACT_ENVIRONMENT',
  'ResizeObserver',
];
let dom: JSDOM;
let saved: Map<string, PropertyDescriptor | undefined>;
let root: Root;
let client: QueryClient;
let originalFetch: typeof fetch;
let content: string;
let otherContent: string;
let denied: boolean;
let dirty: boolean;
let allowLeave: boolean;
let holdLink: ((response: Response) => void) | null;
let holdNext: boolean;
const navigations: string[] = [];
const requests: {
  url: URL;
  method: string;
  body?: { content: string; expectedEtag: string; path: string };
}[] = [];

beforeEach(async () => {
  saved = new Map(globals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: 'https://helena.test/',
    pretendToBeVisual: true,
  });
  for (const name of globals)
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value:
        name === 'ResizeObserver'
          ? class {
              observe() {}
              unobserve() {}
              disconnect() {}
            }
          : name === 'IS_REACT_ACT_ENVIRONMENT'
            ? true
            : name === 'requestAnimationFrame'
              ? (callback: FrameRequestCallback) => setTimeout(callback, 0)
              : name === 'cancelAnimationFrame'
                ? clearTimeout
                : (dom.window as unknown as Record<string, unknown>)[name],
    });
  dom.window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => true,
  });
  ({ default: VaultTextEditor } = await import('./VaultTextEditor'));
  ({ default: UnifiedFileViewer } = await import('./UnifiedFileViewer'));
  ({ default: FileBrowser } = await import('./FileBrowser'));
  const { createRoot } = await import('react-dom/client');
  root = createRoot(document.querySelector('#root')!);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  content = original;
  otherContent = original;
  denied = true;
  dirty = false;
  allowLeave = true;
  holdLink = null;
  holdNext = false;
  navigations.length = 0;
  requests.length = 0;
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ url, method, body });
    if (url.pathname === '/projects/RES/files')
      return Response.json({
        root: 'vault',
        path: 'Docs/AI',
        vaultPath: 'Projects/RES/Docs/AI',
        absolutePath: '/synthetic/Projects/RES/Docs/AI',
        writable: true,
        truncated: false,
        items: [
          {
            name: '00-Start.md',
            path,
            kind: 'file',
            sizeBytes: Buffer.byteLength(content),
            contentType: 'text/markdown',
            updatedAt: null,
          },
        ],
      });
    if (url.pathname === '/api/auth/get-session') return Response.json(null);
    if (url.pathname === '/knowledge/documents')
      return Response.json({
        path: canonical,
        kind: 'note',
        title: 'Research',
        mime: 'text/markdown',
        sizeBytes: Buffer.byteLength(content),
        sha256: sha(content),
        updatedAt: new Date().toISOString(),
        projectKey: 'RES',
        content,
        body: markdownContent(content).body,
        frontmatter: { tags: ['ai', 'jev'] },
        truncated: false,
        extractionStatus: 'ready',
        absolutePath: '/synthetic/Projects/RES/Docs/AI/00-Start.md',
      });
    if (url.pathname === '/knowledge/notes' && method === 'PUT') {
      assert.equal(body.path, canonical);
      assert.equal(body.expectedSha, sha(content));
      content = body.body;
      return Response.json({
        path: canonical,
        sha256: sha(content),
        created: false,
        title: 'Research',
      });
    }
    if (url.pathname === '/knowledge/backlinks' || url.pathname === '/knowledge/history')
      return Response.json([]);
    if (['/projects/RES/files/text', '/projects/OTHER/files/text'].includes(url.pathname)) {
      const other = url.pathname.includes('/OTHER/');
      const current = other ? otherContent : content;
      assert.equal(url.searchParams.get('root'), 'vault');
      if (method === 'PUT') {
        assert.equal(body.path, path);
        if (body.expectedEtag !== sha(current))
          return Response.json({ error: 'Changed' }, { status: 409 });
        if (other) otherContent = body.content;
        else content = body.content;
      } else assert.equal(url.searchParams.get('path'), path);
      return Response.json({
        path,
        content: other ? otherContent : content,
        etag: sha(other ? otherContent : content),
        sizeBytes: Buffer.byteLength(other ? otherContent : content),
      });
    }
    if (url.pathname === '/knowledge/wikilink') {
      assert.equal(url.searchParams.get('from'), canonical);
      if (holdNext)
        return new Promise<Response>((resolve) => {
          holdLink = resolve;
        });
      const requested = url.searchParams.get('target');
      if (requested === foreign.slice(0, -3) && denied)
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      return Response.json({ path: requested === target.slice(0, -3) ? target : foreign });
    }
    if (
      ['/projects/RES/files/references', '/projects/OTHER/files/references'].includes(url.pathname)
    ) {
      assert.equal(url.searchParams.get('path'), path);
      return Response.json({
        author: 'Synthetic author',
        runId: null,
        links: [
          { kind: 'issue', title: 'Linked task', href: '/RES-12' },
          { kind: 'chat', title: 'Own chat', href: '/project/RES/ai-team?chat=123' },
        ],
      });
    }
    throw new Error(`Unexpected synthetic request: ${method} ${url.pathname}`);
  }) as typeof fetch;
});

afterEach(async () => {
  await act(async () => root.unmount());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  cleanStores(authClient.$store.atoms.session);
  client.clear();
  globalThis.fetch = originalFetch;
  dom.window.close();
  for (const [name, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

async function render({
  editable = true,
  visible = true,
  viewer = false,
  projectKey = 'RES',
  browser = false,
  previewName = '00-Start.md',
  previewType = 'text/markdown',
  selected = null as string | null,
  sourceOnly = false,
} = {}) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <AppRouterContext.Provider
          value={{ push: (href: string) => navigations.push(href), prefetch: () => {} } as never}
        >
          <NextIntlClientProvider
            locale="en"
            timeZone="UTC"
            messages={{ files, documents, common }}
          >
            <SessionProvider>
              <RelativeTimeProvider>
                <WebLinksContext.Provider value={{ scope: 'WRONG', open: () => {} }}>
                  {visible &&
                    (browser ? (
                      <FileBrowser
                        scope={scope}
                        path="Docs/AI"
                        selected={selected}
                        rootLabel="Knowledge"
                        permissions={{ create: false, edit: true, delete: false }}
                        leading={<Link href="/project/RES/files?root=code">Code tab</Link>}
                        onSelect={(file) => {
                          void render({ browser: true, selected: file });
                        }}
                        onNavigate={(folder) => navigations.push(folder)}
                      />
                    ) : viewer ? (
                      <UnifiedFileViewer
                        file={{
                          name: previewName,
                          sizeBytes: Buffer.byteLength(content),
                          url: '/synthetic',
                          contentType: previewType,
                          vaultPath: 'Projects/WRONG/Docs/00-Start.md',
                        }}
                        scope={{ ...scope, projectKey }}
                        path={path}
                        canEdit={editable}
                        actions={null}
                        onClose={() => {}}
                        sourceOnly={sourceOnly}
                      />
                    ) : (
                      <VaultTextEditor
                        scope={{ ...scope, projectKey }}
                        path={path}
                        canEdit={editable}
                        vaultPath={canonical}
                        onDirty={(value) => {
                          dirty = value;
                        }}
                        beforeNavigate={() => allowLeave}
                        sourceOnly={sourceOnly}
                      />
                    ))}
                </WebLinksContext.Provider>
              </RelativeTimeProvider>
            </SessionProvider>
          </NextIntlClientProvider>
        </AppRouterContext.Provider>
      </QueryClientProvider>,
    ),
  );
}

async function until(check: () => boolean) {
  for (let attempt = 0; attempt < 100 && !check(); attempt++)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  assert.ok(check(), 'Expected rendered editor state did not arrive');
}

function editor() {
  const element = document.querySelector('.tiptap') as (HTMLElement & { editor: Editor }) | null;
  assert.ok(element?.editor);
  return element.editor;
}

function saveButton() {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (node) => node.textContent === files.unified.save,
  );
  assert.ok(button);
  return button;
}

async function openWiki(label: string) {
  const instance = editor();
  let handled = false;
  await act(async () => {
    instance.state.doc.descendants((node, pos) => {
      if (node.type.name !== 'wikilink' || !String(node.attrs.inner).endsWith(`|${label}`)) return;
      handled = !!instance.view.someProp('handleClickOn', (handle) =>
        handle(
          instance.view,
          pos,
          node,
          pos,
          new dom.window.MouseEvent('click') as unknown as MouseEvent,
          true,
        ),
      );
    });
  });
  assert.equal(handled, true, 'The actual rendered wiki node must have a click handler');
}

async function append() {
  await act(async () => {
    editor().commands.insertContentAt(editor().state.doc.content.size, '<p>Saved addition</p>');
  });
  await until(() => dirty);
}

function sourceArea() {
  const area = document.querySelector<HTMLTextAreaElement>(
    `textarea[aria-label="${files.unified.source}"]`,
  );
  assert.ok(area);
  return area;
}

async function sourceEdit(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value')!.set!.call(
      sourceArea(),
      value,
    );
    sourceArea().dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
}

async function chooseMode(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (node) => node.textContent === label,
  );
  assert.ok(button);
  await act(async () => button.click());
}

it('renders wiki links while opening and permission toggles preserve exact original bytes', async () => {
  await render();
  await until(() => !!document.querySelector('.tiptap'));
  assert.equal(document.querySelector('[data-wikilink]')?.textContent, 'Overview');
  assert.ok(
    [...document.querySelectorAll('[data-wikilink]')].some((node) => node.textContent === 'SPY'),
  );
  assert.equal(saveButton().disabled, true);
  assert.equal(dirty, false);
  await render({ editable: false });
  assert.equal(editor().isEditable, false);
  await render();
  assert.equal(editor().isEditable, true);
  assert.equal(saveButton().disabled, true);
  assert.equal(content, original);
  assert.equal(requests.filter((request) => request.method === 'PUT').length, 0);
  assert.equal(markdownContent(original).prefix, prefix);
});

it('saves the same file with its original hash, metadata and canonical links intact', async () => {
  await render();
  await until(() => !!document.querySelector('.tiptap'));
  await append();
  await act(async () => saveButton().click());
  await until(() => !dirty && saveButton().disabled);
  const writes = requests.filter((request) => request.method === 'PUT');
  assert.equal(writes.length, 1);
  assert.equal(writes[0]?.body?.expectedEtag, sha(original));
  assert.ok(content.startsWith(prefix));
  assert.ok(content.includes(`[[${target.slice(0, -3)}|Overview]]`));
  assert.ok(content.includes(table));
  assert.ok(content.includes(softBreak));
  assert.ok(content.includes('Assets/chart.png'));
  assert.ok(!content.includes('/protected-media/'));
  assert.ok(content.includes('Saved addition'));
  assert.ok(vaultNotePath(target).startsWith('/project/RES/files?'));
});

it('keeps a local draft and its original hash after a conflicting external write and refetch', async () => {
  await render();
  await until(() => !!document.querySelector('.tiptap'));
  await append();
  content = `${original}\nExternal addition\n`;
  await act(async () => {
    await client.invalidateQueries({ queryKey: filesScopeKey(scope) });
  });
  assert.ok(editor().getText().includes('Saved addition'));
  await act(async () => saveButton().click());
  await until(() => !saveButton().disabled);
  assert.equal(dirty, true);
  assert.ok(editor().getText().includes('Saved addition'));
  assert.ok(!editor().getText().includes('External addition'));
  assert.equal(content, `${original}\nExternal addition\n`);
  assert.equal(
    requests.find((request) => request.method === 'PUT')?.body?.expectedEtag,
    sha(original),
  );
});

it('resolves the current source path, denies foreign access and navigates an allowed target in its own project', async () => {
  await render();
  await until(() => !!document.querySelector('.tiptap'));
  await openWiki('Foreign');
  assert.deepEqual(navigations, []);
  denied = false;
  await openWiki('Foreign');
  assert.deepEqual(navigations, [vaultNotePath(foreign)]);
  allowLeave = false;
  await openWiki('Overview');
  assert.equal(navigations.length, 1);
  allowLeave = true;
  await openWiki('Overview');
  assert.equal(navigations[1], vaultNotePath(target));
  assert.ok(requests.every((request) => request.method === 'GET'));
});

it('ignores an older wiki response after the source editor has closed', async () => {
  await render();
  await until(() => !!document.querySelector('.tiptap'));
  holdNext = true;
  await openWiki('Overview');
  assert.ok(holdLink);
  await render({ visible: false });
  await act(async () => {
    holdLink!(Response.json({ path: target }));
  });
  assert.deepEqual(navigations, []);
});

it('uses actual file scope in the unified viewer and retains canonical task/chat references', async () => {
  await render({ viewer: true, editable: false });
  await until(
    () => !!document.querySelector('.tiptap') && !!document.querySelector('a[href="/RES-12"]'),
  );
  assert.equal(document.querySelector('iframe'), null);
  const source = document.querySelector('a[href="https://example.test/source"]');
  assert.ok(source);
  assert.equal(webLinkScope(source, 'WRONG'), 'RES');
  await openWiki('Overview');
  assert.deepEqual(navigations, [vaultNotePath(target)]);
  assert.ok(document.querySelector('a[href="/project/RES/ai-team?chat=123"]'));
  assert.equal(
    requests.some((request) => request.url.pathname.includes('/WRONG/')),
    false,
  );
});

it('guards dirty wiki and task links in the actual unified viewer', async () => {
  await render({ viewer: true });
  await until(() => !!document.querySelector('.tiptap'));
  await act(async () => {
    editor().commands.insertContentAt(editor().state.doc.content.size, '<p>Unsaved work</p>');
  });
  await until(() => !saveButton().disabled);
  let confirmations = 0;
  dom.window.confirm = () => {
    confirmations++;
    return false;
  };
  await openWiki('Overview');
  assert.deepEqual(navigations, []);
  const task = document.querySelector('a[href="/RES-12"]')!;
  const click = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true });
  await act(async () => {
    task.dispatchEvent(click);
  });
  assert.equal(click.defaultPrevented, true);
  assert.deepEqual(navigations, []);
  assert.equal(confirmations, 2);
  assert.ok(editor().getText().includes('Unsaved work'));
  dom.window.confirm = () => true;
  await openWiki('Overview');
  assert.deepEqual(navigations, [vaultNotePath(target)]);
  assert.equal(
    requests.some((request) => request.method === 'PUT'),
    false,
  );
});

it('never carries a dirty draft into another project with the same path and original hash', async () => {
  await render({ viewer: true });
  await until(() => !!document.querySelector('.tiptap'));
  await act(async () => {
    editor().commands.insertContentAt(editor().state.doc.content.size, '<p>Only RES draft</p>');
  });
  await until(() => !saveButton().disabled);
  await render({ viewer: true, projectKey: 'OTHER' });
  await until(() => !!document.querySelector('.tiptap') && saveButton().disabled);
  assert.ok(!editor().getText().includes('Only RES draft'));
  assert.equal(content, original);
  assert.equal(otherContent, original);
  assert.equal(
    requests.some((request) => request.method === 'PUT'),
    false,
  );
  assert.ok(requests.some((request) => request.url.pathname === '/projects/OTHER/files/text'));
});

for (const [name, body] of [
  [
    'relative links and HTML comments',
    '# Guide\n\n[Guide](Other.md)\n\n<!-- keep this source note -->\n\nVisible text\n',
  ],
  [
    'reference links and custom HTML',
    '# Guide\n\n[Guide][reference]\n\n[reference]: Other.md "Original title"\n\n<custom-data data-id="retained">Raw content</custom-data>\n',
  ],
  ['body CRLF endings', '# Guide\r\n\r\nText with original line endings\r\n'],
  [
    'block image spacing',
    '# Guide\n\n![Chart](Assets/chart.png)\n\n[Source](https://example.test/source)\n',
  ],
] as const) {
  it(`edits ${name} in source and preserves every untouched byte on a real save`, async () => {
    const before = prefix + body;
    content = before;
    await render();
    await until(() => !!document.querySelector('.tiptap'));
    assert.equal(editor().isEditable, false);
    assert.equal(document.querySelector('textarea'), null);
    await chooseMode(files.unified.source);
    await until(() => !!document.querySelector('textarea'));
    assert.equal(sourceArea().value, before.replace(/\r\n/g, '\n'));
    assert.equal(saveButton().disabled, true);
    assert.equal(content, before);
    const after = before + '\nAdded source text';
    await sourceEdit(after);
    await until(() => dirty);
    await act(async () => saveButton().click());
    await until(() => !dirty);
    assert.equal(content, after);
    assert.equal(
      requests.find((request) => request.method === 'PUT')?.body?.expectedEtag,
      sha(before),
    );
  });
}

it('keeps the current raw draft and original ETag through preview, conflict, refetch and partial undo', async () => {
  const before = `${prefix}# Guide\n\n[Guide](Other.md)\n\n<!-- retain -->\n`;
  content = before;
  await render();
  await until(() => !!document.querySelector('.tiptap'));
  await chooseMode(files.unified.source);
  await until(() => !!document.querySelector('textarea'));
  const draft = `${before}\nLocal A\nLocal B`;
  await sourceEdit(draft);
  await until(() => dirty);
  await chooseMode(files.unified.formatted);
  await until(() => !!document.querySelector('.tiptap'));
  assert.equal(editor().isEditable, false);
  assert.ok(editor().getText().includes('Local B'));
  await chooseMode(files.unified.source);
  assert.equal(sourceArea().value, draft.replace(/\r\n/g, '\n'));
  content = `${before}\nExternal addition`;
  await act(async () => {
    await client.invalidateQueries({ queryKey: filesScopeKey(scope) });
  });
  await sourceEdit(`${before}\nLocal A`);
  await act(async () => saveButton().click());
  await until(() => !saveButton().disabled);
  assert.equal(dirty, true);
  assert.equal(content, `${before}\nExternal addition`);
  assert.equal(
    requests.find((request) => request.method === 'PUT')?.body?.expectedEtag,
    sha(before),
  );
  await chooseMode(files.unified.formatted);
  await until(() => !!document.querySelector('.tiptap'));
  assert.equal(editor().isEditable, false);
  assert.ok(editor().getText().includes('Local A'));
  assert.ok(!editor().getText().includes('Local B'));
  await chooseMode(files.unified.source);
  assert.equal(sourceArea().value, `${before}\nLocal A`.replace(/\r\n/g, '\n'));
});

it('keeps both source and formatted surfaces read-only after permission is revoked', async () => {
  await render();
  await until(() => !!document.querySelector('.tiptap') && editor().isEditable);
  await render({ editable: false });
  assert.equal(editor().isEditable, false);
  await chooseMode(files.unified.source);
  assert.equal(sourceArea().readOnly, true);
  await sourceEdit('Attempted replacement');
  await chooseMode(files.unified.formatted);
  await until(() => !!document.querySelector('.tiptap'));
  assert.equal(editor().isEditable, false);
  assert.ok(editor().getText().includes('Research'));
  assert.equal(
    requests.some((request) => request.method === 'PUT'),
    false,
  );
  assert.equal(content, original);
});

it('rechecks the current source draft before enabling formatted edits and saves against its original ETag', async () => {
  const before = `${prefix}# Guide\n\n[Guide](Other.md)\n\n<!-- retain -->\n`;
  content = before;
  await render();
  await until(() => !!document.querySelector('.tiptap'));
  await chooseMode(files.unified.source);
  await until(() => !!document.querySelector('textarea'));
  const plain = `${prefix}# Safe draft\n`;
  await sourceEdit(plain);
  await until(() => dirty);
  await chooseMode(files.unified.formatted);
  await until(() => !!document.querySelector('.tiptap') && editor().isEditable);
  assert.ok(editor().getText().includes('Safe draft'));
  assert.ok(!editor().getText().includes('Guide'));
  await append();
  await act(async () => saveButton().click());
  await until(() => !dirty);
  assert.equal(
    requests.find((request) => request.method === 'PUT')?.body?.expectedEtag,
    sha(before),
  );
  assert.equal(content, `${prefix}# Safe draft\n\nSaved addition\n`);
});

it('keeps the initial ETag after a full source undo and a later edit following refetch', async () => {
  const before = `${prefix}# Guide\n\n[Guide](Other.md)\n\n<!-- retain -->\n`;
  content = before;
  await render();
  await until(() => !!document.querySelector('.tiptap'));
  await chooseMode(files.unified.source);
  await until(() => !!document.querySelector('textarea'));
  await sourceEdit(`${before}\nFirst edit`);
  await until(() => dirty);
  content = `${before}\nExternal addition`;
  await act(async () => {
    await client.invalidateQueries({ queryKey: filesScopeKey(scope) });
  });
  await sourceEdit(before);
  await until(() => !dirty);
  assert.equal(sourceArea().value, before.replace(/\r\n/g, '\n'));
  assert.equal(saveButton().disabled, true);
  await chooseMode(files.unified.formatted);
  await until(() => !!document.querySelector('.tiptap'));
  assert.equal(editor().isEditable, false);
  await chooseMode(files.unified.source);
  await sourceEdit(`${before}\nSecond edit`);
  await until(() => dirty);
  await act(async () => saveButton().click());
  await until(() => !saveButton().disabled);
  assert.equal(
    requests.find((request) => request.method === 'PUT')?.body?.expectedEtag,
    sha(before),
  );
  assert.equal(content, `${before}\nExternal addition`);
  assert.equal(dirty, true);
});

it('reattaches only exact trailing LF bytes and never trims spaces or normalizes CRLF', () => {
  assert.equal(preserveMarkdownEnding('body\n\n', 'body'), 'body\n\n');
  assert.equal(preserveMarkdownEnding('body', 'body\n'), 'body');
  assert.equal(preserveMarkdownEnding('body  \n', 'body'), 'body\n');
  assert.notEqual(preserveMarkdownEnding('body  \n', 'body'), 'body  \n');
  assert.notEqual(preserveMarkdownEnding('body\r\n', 'body'), 'body\r\n');
});

it('preserves executable-looking source as data without running page expressions', async () => {
  const before =
    '# Synthetic note\n\n```space-lua\njs.window.fixtureExecuted = true\n```\n\n${js.window.fixtureExecuted = true}\n';
  content = before;
  await render({ viewer: true });
  await until(() => !!document.querySelector('.tiptap') || !!document.querySelector('textarea'));
  assert.equal(document.querySelector('iframe'), null);
  assert.equal(Reflect.get(window, 'fixtureExecuted'), undefined);
  assert.equal(content, before);
  assert.equal(
    requests.some((request) => request.method === 'PUT'),
    false,
  );
  if (!document.querySelector('textarea')) await chooseMode(files.unified.source);
  const after = before + '\nOrdinary text addition\n';
  await sourceEdit(after);
  await until(() => !saveButton().disabled);
  await act(async () => saveButton().click());
  await until(() => saveButton().disabled);
  assert.equal(content, after);
  assert.equal(Reflect.get(window, 'fixtureExecuted'), undefined);
  assert.equal(
    requests.find((request) => request.method === 'PUT')?.body?.expectedEtag,
    sha(before),
  );
});

it('opens Markdown inline from the project file list in the Docs editor', async () => {
  await render({ browser: true });
  await until(
    () =>
      !![...document.querySelectorAll('button')].find(
        (node) => node.textContent?.trim() === '00-Start',
      ),
  );
  const file = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (node) => node.textContent?.trim() === '00-Start',
  )!;
  await act(async () => file.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true })));
  await until(() => !!document.querySelector('[data-file-preview] .tiptap'));
  assert.deepEqual(navigations, []);
  assert.equal(content, original);
  assert.ok(requests.every((request) => request.method === 'GET'));
});

it('saves edits from the inline Docs canvas against the loaded revision', async () => {
  content = '## Heading\n\nHello';
  await render({ browser: true, selected: path });
  await until(() => !!document.querySelector('[data-file-preview] .tiptap'));
  await until(() => editor().isEditable);
  await act(async () => editor().commands.setContent('<h2>Heading</h2><p>Hello World</p>'));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 800));
  });
  await until(() => requests.some((request) => request.url.pathname === '/knowledge/notes'));
  assert.ok(content.includes('Hello World'));
});

it('opens source from the document menu without a mode switch or persistent warning', async () => {
  await render({ viewer: true, sourceOnly: true });
  await until(() => !!document.querySelector('textarea'));
  assert.equal(sourceArea().value, original.replace(/\r\n/g, '\n'));
  assert.equal(document.querySelector('button[aria-pressed]'), null);
  // No note about Markdown the formatted editor cannot keep (owner, O15).
  assert.doesNotMatch(document.body.textContent ?? '', /formatted editor|formatierte Editor/i);
  assert.ok(!document.body.textContent?.includes(files.unified.original));
  assert.ok(!requests.some((request) => request.url.pathname.endsWith('/files/references')));
});

it('reopens formatted after a deliberate source view without changing the original bytes', async () => {
  const before = prefix + '# Guide\r\n\r\n<!-- untouched -->\r\n';
  content = before;
  await render({ viewer: true });
  await until(() => !!document.querySelector('.tiptap'));
  assert.equal(editor().isEditable, false);
  assert.equal(document.querySelector('textarea'), null);
  await chooseMode(files.unified.source);
  assert.ok(document.querySelector('textarea'));
  await render({ visible: false });
  await render({ viewer: true });
  await until(() => !!document.querySelector('.tiptap'));
  assert.equal(document.querySelector('textarea'), null);
  assert.equal(content, before);
  assert.ok(requests.every((request) => request.method === 'GET'));
});

for (const [name, type, selector] of [
  ['Example.pdf', 'application/pdf', 'iframe'],
  ['Example.png', 'image/png', 'img'],
  ['Example.mp3', 'audio/mpeg', 'audio'],
  ['Example.mp4', 'video/mp4', 'video'],
] as const) {
  it(`keeps the existing ${type} renderer in the inline main-content surface`, async () => {
    await render({ viewer: true, previewName: name, previewType: type });
    const surface = document.querySelector('#root [data-file-preview]')!;
    assert.ok(surface);
    assert.equal(document.querySelector('[role="dialog"]'), null);
    const media = surface.querySelector(selector)!;
    assert.ok(media);
    assert.equal(media.getAttribute('src'), '/synthetic');
    if (selector === 'iframe') assert.equal(media.hasAttribute('sandbox'), false);
    assert.ok(requests.every((request) => request.method === 'GET'));
  });
}
