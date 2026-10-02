import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act } from 'react';
import { withDom } from '../../../test/dom';
import de from '../../../messages/de/display.json';
import en from '../../../messages/en/display.json';
import uk from '../../../messages/uk/display.json';
import ru from '../../../messages/ru/display.json';
import zh from '../../../messages/zh-CN/display.json';
import ar from '../../../messages/ar/display.json';
import fr from '../../../messages/fr/display.json';
import pt from '../../../messages/pt-BR/display.json';
import id from '../../../messages/id/display.json';
import es from '../../../messages/es-ES/display.json';

test('icon-only layout tabs keep their translated names and selection', async () => {
  await withDom('https://volition.test/', async (dom) => {
    const { Segmented } = await import('./Segmented');
    const { createRoot } = await import('react-dom/client');
    const root = createRoot(document.querySelector('#root')!);
    const picked: string[] = [];
    const style = document.createElement('style');
    // This is the mobile rule: words beside icons are hidden, but each view must
    // remain named for keyboard users and assistive technology.
    style.textContent = '.ds-segmented > button > svg ~ span { display: none; }';
    document.head.append(style);
    try {
      for (const messages of [de, en, uk, ru, zh, ar, fr, pt, id, es]) {
        const options = ['calendar', 'timeline'].map((value) => ({
          value,
          label: messages.layouts[value as 'calendar' | 'timeline'],
          icon: <svg aria-hidden="true" />,
        }));
        await act(async () => {
          root.render(
            <Segmented
              value="calendar"
              options={options}
              label={messages.title}
              onChange={(v) => picked.push(v)}
            />,
          );
        });
        const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
        assert.equal(tabs.length, 2);
        assert.ok(
          tabs.every(
            (tab) => dom.window.getComputedStyle(tab.querySelector('span')!).display === 'none',
          ),
        );
        assert.deepEqual(
          tabs.map((tab) => tab.getAttribute('aria-label')),
          options.map((option) => option.label),
        );
        assert.equal(tabs[0].getAttribute('aria-selected'), 'true');
        await act(async () => tabs[1].click());
        assert.equal(picked.at(-1), 'timeline');
      }
    } finally {
      await act(async () => root.unmount());
      style.remove();
    }
  });
});
