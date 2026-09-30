import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act } from 'react';
import { withDom } from '../../../test/dom';

// The header is ONE bar (owner 30.09., O104): a breadcrumb whose last part is the page's title
// (no second title), then the slot for the page's controls, then the slot for its main action.
test('the header is one bar: breadcrumb ending in the title, controls slot, action slot', async () => {
  await withDom('https://ava.example/project/VOL/files', async () => {
    const { PageHeader } = await import('./Page');
    const { createRoot } = await import('react-dom/client');
    const root = createRoot(document.querySelector('#root')!);
    try {
      await act(async () =>
        root.render(
          <PageHeader
            crumbs={[
              { label: 'volition.one', href: '/project/VOL' },
              { label: 'Wissen', href: '/project/VOL/files' },
            ]}
            title="Dokumente"
            bar={<button type="button">Alle</button>}
            actions={<button type="button">Neu</button>}
          />,
        ),
      );
      const header = document.querySelector('header')!;
      // One h1: the page's own name, the last part of the breadcrumb.
      assert.equal(header.querySelectorAll('h1').length, 1);
      assert.equal(header.querySelector('h1')!.textContent, 'Dokumente');
      const crumbs = [...header.querySelectorAll('.ds-page-crumb a')].map((a) => [
        a.textContent,
        a.getAttribute('href'),
      ]);
      assert.deepEqual(crumbs, [
        ['volition.one', '/project/VOL'],
        ['Wissen', '/project/VOL/files'],
      ]);
      // The order of the bar: name, the page's controls, the main action at the end.
      const order = [...header.children].map((child) => child.className.split(' ')[0]);
      assert.deepEqual(order, ['ds-page-heading', 'ds-page-bar', 'ds-page-actions']);
      assert.equal(header.querySelector('.ds-page-bar')!.textContent, 'Alle');
      assert.equal(header.querySelector('.ds-page-actions')!.textContent, 'Neu');
    } finally {
      await act(async () => root.unmount());
    }
  });
});

test('a page without crumbs shows its name alone', async () => {
  await withDom('https://ava.example/dashboard', async () => {
    const { PageHeader } = await import('./Page');
    const { createRoot } = await import('react-dom/client');
    const root = createRoot(document.querySelector('#root')!);
    try {
      await act(async () => root.render(<PageHeader title="Dashboard" />));
      assert.equal(document.querySelectorAll('.ds-page-crumb').length, 0);
      assert.equal(document.querySelector('h1')!.textContent, 'Dashboard');
    } finally {
      await act(async () => root.unmount());
    }
  });
});

// The breadcrumb and the title are switched off in the bar by ONE constant (owner 30.09.): the
// bar is marked hidden (CSS lays the heading out of sight, it stays for assistive technology) and
// `showHeading` brings it back for a place that wants it.
test('the heading is hidden in the bar by the one switch, and comes back with showHeading', async () => {
  await withDom('https://ava.example/tasks', async () => {
    const { PageHeader } = await import('./Page');
    const { PAGE_HEADING_VISIBLE } = await import('./pageChrome');
    const { createRoot } = await import('react-dom/client');
    const root = createRoot(document.querySelector('#root')!);
    try {
      assert.equal(PAGE_HEADING_VISIBLE, false);
      await act(async () =>
        root.render(<PageHeader crumbs={[{ label: 'Ava' }]} title="Aufgaben" />),
      );
      const header = document.querySelector('header')!;
      assert.equal(header.getAttribute('data-heading'), 'hidden');
      // Still in the page for screen readers.
      assert.equal(header.querySelector('h1')!.textContent, 'Aufgaben');
      await act(async () =>
        root.render(<PageHeader crumbs={[{ label: 'Ava' }]} title="Aufgaben" showHeading />),
      );
      assert.equal(header.getAttribute('data-heading'), null);
    } finally {
      await act(async () => root.unmount());
    }
  });
});
