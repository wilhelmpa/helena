import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { act } from 'react';
import type { Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { JSDOM } from 'jsdom';
import chatWorkspace from '../../../../../messages/en/chatWorkspace.json';
import type { PlanUIMessage } from '../../utils/chatMessages';
import ChatBranchNav from './ChatBranchNav';

const replacedGlobals = [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'IS_REACT_ACT_ENVIRONMENT',
] as const;
let dom: JSDOM;
let root: Root;
let originalGlobalDescriptors: Map<string, PropertyDescriptor | undefined>;

function render(node: React.ReactNode) {
  act(() =>
    root.render(
      <NextIntlClientProvider locale="en" messages={{ chatWorkspace }} timeZone="UTC">
        {node}
      </NextIntlClientProvider>,
    ),
  );
}

beforeEach(async () => {
  originalGlobalDescriptors = new Map(
    replacedGlobals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  );
  dom = new JSDOM('<!doctype html><div id="root"></div>');
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
  });
  const { createRoot } = await import('react-dom/client');
  const element = document.querySelector('#root');
  assert.ok(element);
  root = createRoot(element);
});

afterEach(() => {
  act(() => root.unmount());
  dom.window.close();
  for (const [name, descriptor] of originalGlobalDescriptors) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

function message(id: string, siblingIds: string[]): PlanUIMessage {
  return { id, role: 'assistant', parts: [], metadata: { siblingIds } };
}

describe('ChatBranchNav', () => {
  it('renders nothing for a message with no other version', () => {
    render(<ChatBranchNav message={message('1', ['1'])} onSwitchVersion={() => {}} />);
    assert.equal(document.body.textContent, '');
  });

  it('shows the position among siblings and disables the edge buttons', () => {
    render(<ChatBranchNav message={message('2', ['1', '2', '3'])} onSwitchVersion={() => {}} />);
    assert.match(document.body.textContent ?? '', /2\/3/);
    const buttons = [...document.querySelectorAll('button')];
    assert.equal(buttons.length, 2);
    assert.equal(buttons[0].disabled, false);
    assert.equal(buttons[1].disabled, false);
  });

  it('disables previous on the first version and next on the last', () => {
    render(<ChatBranchNav message={message('1', ['1', '2'])} onSwitchVersion={() => {}} />);
    const [previous, next] = [...document.querySelectorAll('button')];
    assert.equal(previous.disabled, true);
    assert.equal(next.disabled, false);
  });

  it('asks to switch to the neighbouring version on click', () => {
    const switched: string[] = [];
    render(
      <ChatBranchNav
        message={message('2', ['1', '2', '3'])}
        onSwitchVersion={(id) => switched.push(id)}
      />,
    );
    const [previous, next] = [...document.querySelectorAll('button')];
    act(() => previous.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    act(() => next.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    assert.deepEqual(switched, ['1', '3']);
  });
});
