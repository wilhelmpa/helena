import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { installWebLinkNavigation, requestWebLink, webLinkKind } from './webLinkNavigation';
import { authenticationLinkRef, registerWebLinkScope, type WebLinkScope } from './webLinkScope';

function setup() {
  const dom = new JSDOM(
    '<div id="root"><a href="https://example.test/docs"><span>Docs</span></a></div>',
    { url: 'https://helena.test/project/VOL' },
  );
  const opened: [string, WebLinkScope][] = [];
  const unlink = installWebLinkNavigation(
    dom.window.document,
    (url, scope) => opened.push([url, scope]),
    () => 'VOL',
    dom.window.location.href,
  );
  return {
    dom,
    opened,
    link: dom.window.document.querySelector('a')!,
    root: dom.window.document.querySelector('div')!,
    cleanup() {
      unlink();
      dom.window.close();
    },
  };
}

for (const [label, type, init] of [
  ['plain link and nested icon', 'click', { button: 0 }],
  ['Command-click', 'click', { button: 0, metaKey: true }],
  ['Ctrl-click', 'click', { button: 0, ctrlKey: true }],
  ['Shift-click', 'click', { button: 0, shiftKey: true }],
  ['middle click', 'auxclick', { button: 1 }],
] as const) {
  test(`${label} opens exactly one source-project browser tab and suppresses row handlers`, () => {
    const t = setup();
    try {
      let rowOpened = false;
      t.root.addEventListener('click', () => {
        rowOpened = true;
      });
      const event = new t.dom.window.MouseEvent(type, { ...init, bubbles: true, cancelable: true });
      t.link.querySelector('span')!.dispatchEvent(event);
      assert.equal(event.defaultPrevented, true);
      assert.equal(rowOpened, false);
      assert.deepEqual(t.opened, [['https://example.test/docs', 'VOL']]);
    } finally {
      t.cleanup();
    }
  });
}

test('Enter and an editor-selected anchor use the original link scope', () => {
  const t = setup();
  try {
    registerWebLinkScope(t.root, 'OTHER');
    t.link.dispatchEvent(
      new t.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    assert.equal(requestWebLink(t.link), true);
    assert.deepEqual(t.opened, [
      ['https://example.test/docs', 'OTHER'],
      ['https://example.test/docs', 'OTHER'],
    ]);
  } finally {
    t.cleanup();
  }
});

test('source Home, source project and unresolved scope override the surrounding project; HTML cannot forge them', () => {
  const t = setup();
  try {
    t.link.setAttribute('data-browser-project', 'FORGED');
    t.link.setAttribute('data-browser-native', 'true');
    requestWebLink(t.link);
    registerWebLinkScope(t.root, null);
    requestWebLink(t.link);
    registerWebLinkScope(t.root, undefined);
    requestWebLink(t.link);
    assert.deepEqual(
      t.opened.map((entry) => entry[1]),
      ['VOL', null, undefined],
    );
  } finally {
    t.cleanup();
  }
});

test('app files and self-contained downloads stay native; a forged foreign download stays internal', () => {
  const t = setup();
  try {
    for (const href of [
      '/project/OTHER',
      '/protected-media/attachments/test/view',
      'https://helena.test/docs',
      'blob:https://helena.test/id',
      'mailto:owner@example.test',
      'tel:+4900',
    ]) {
      t.link.href = href;
      assert.equal(requestWebLink(t.link), false, href);
    }
    t.link.download = 'file.csv';
    for (const href of [
      '/protected-media/file?download=1',
      'blob:https://helena.test/id',
      'data:text/csv,a%2Cb',
    ]) {
      t.link.href = href;
      assert.equal(requestWebLink(t.link), false);
    }
    t.link.href = 'https://example.test/download';
    assert.equal(requestWebLink(t.link), true);
    assert.deepEqual(t.opened, [['https://example.test/download', 'VOL']]);
  } finally {
    t.cleanup();
  }
});

test('only registered authentication anchors bypass capture, not their host or arbitrary HTML attributes', () => {
  const t = setup();
  try {
    authenticationLinkRef(t.link);
    assert.equal(requestWebLink(t.link), false);
    const other = t.link.cloneNode(true) as HTMLAnchorElement;
    t.root.append(other);
    assert.equal(requestWebLink(other), true);
    assert.equal(t.opened.length, 1);
  } finally {
    t.cleanup();
  }
});

test('unsafe protocols and credentials cannot navigate or reach the internal browser', () => {
  const t = setup();
  try {
    for (const href of [
      'javascript:alert(1)',
      'data:text/html,secret',
      'file:///private',
      'https://name:password@example.test',
    ]) {
      t.link.href = href;
      assert.equal(requestWebLink(t.link), true, href);
      assert.equal(webLinkKind(href, 'https://helena.test'), 'unsafe');
    }
    assert.equal(t.opened.length, 0);
  } finally {
    t.cleanup();
  }
});

test('plain editor clicks still edit, while a modifier opens without changing the document', () => {
  const t = setup();
  try {
    t.root.setAttribute('contenteditable', 'true');
    const original = t.root.innerHTML;
    // A caller prevents the normal contenteditable click, just as Tiptap does.
    t.root.addEventListener('click', (event) => event.preventDefault());
    t.link.dispatchEvent(new t.dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    assert.equal(t.opened.length, 0);
    t.link.dispatchEvent(
      new t.dom.window.MouseEvent('click', { ctrlKey: true, bubbles: true, cancelable: true }),
    );
    assert.equal(t.opened.length, 1);
    assert.equal(t.root.innerHTML, original);
  } finally {
    t.cleanup();
  }
});

test('sandboxed mail documents use their own DOM realm without enabling scripts', () => {
  const t = setup();
  const mail = new JSDOM('<a href="https://mail-link.test"><b>Open</b></a>');
  const unlink = installWebLinkNavigation(
    mail.window.document,
    (url, scope) => t.opened.push([url, scope]),
    () => null,
    t.dom.window.location.href,
  );
  try {
    mail.window.document
      .querySelector('b')!
      .dispatchEvent(new mail.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    assert.deepEqual(t.opened, [['https://mail-link.test/', null]]);
  } finally {
    unlink();
    mail.window.close();
    t.cleanup();
  }
});
