import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { act } from 'react';
import type { Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { JSDOM } from 'jsdom';
import approvals from '../../../../messages/en/approvals.json';
import type { ApprovalDecision } from '@/lib/api/endpoints/approvals';
import ApprovalDecisionForm from './ApprovalDecisionForm';

const replacedGlobals = [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'IS_REACT_ACT_ENVIRONMENT',
] as const;
let dom: JSDOM;
let root: Root;
let decisions: ApprovalDecision[];
let originalGlobalDescriptors: Map<string, PropertyDescriptor | undefined>;

function render(pending = false) {
  act(() =>
    root.render(
      <NextIntlClientProvider locale="en" messages={{ approvals }} timeZone="UTC">
        <ApprovalDecisionForm pending={pending} onDecide={(decision) => decisions.push(decision)} />
      </NextIntlClientProvider>,
    ),
  );
}

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find((b) =>
    b.textContent?.includes(label),
  );
  assert.ok(found);
  return found;
}

// React tracks a field's value itself, so the value is set through the native setter
// and announced with an input event, the way typing does.
function type(text: string) {
  const field = document.querySelector('textarea');
  assert.ok(field);
  const setter = Object.getOwnPropertyDescriptor(
    dom.window.HTMLTextAreaElement.prototype,
    'value',
  )!.set!;
  act(() => {
    setter.call(field, text);
    field.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
}

beforeEach(async () => {
  originalGlobalDescriptors = new Map(
    replacedGlobals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  );
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://example.test/' });
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: dom.window },
    document: { configurable: true, value: dom.window.document },
    navigator: { configurable: true, value: dom.window.navigator },
    HTMLElement: { configurable: true, value: dom.window.HTMLElement },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
  });
  decisions = [];
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

describe('ApprovalDecisionForm', () => {
  it('approves without a note when none was written', () => {
    render();
    act(() => button(approvals.approve).click());
    assert.deepEqual(decisions, [{ approved: true, note: undefined }]);
  });

  it('rejects with the trimmed note', () => {
    render();
    type('  Not before Monday  ');
    act(() => button(approvals.reject).click());
    assert.deepEqual(decisions, [{ approved: false, note: 'Not before Monday' }]);
  });

  it('takes no second decision while one is being saved', () => {
    render(true);
    assert.equal(button(approvals.approve).disabled, true);
    assert.equal(button(approvals.reject).disabled, true);
  });
});
