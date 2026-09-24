import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { act, useState } from 'react';
import type { Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import type { InputSuggestion } from './RoutineSuggestionsInput';

let dom: JSDOM;
let root: Root;

const SUGGESTIONS: InputSuggestion[] = [
  { value: '*/15 * * * *', label: 'Every 15 minutes' },
  { value: '0 9 * * 1-5', label: 'Weekdays at 9' },
  { value: '0 9 * * *', label: 'Every day at 9' },
];

let current = '';
// Imported once the DOM globals exist: Radix decides at module load whether it has a
// document to lay out in, and without one its popover never renders its content.
let RoutineSuggestionsInput: typeof import('./RoutineSuggestionsInput').RoutineSuggestionsInput;
function Field() {
  const [value, setValue] = useState('');
  current = value;
  return (
    <form onSubmit={(event) => event.preventDefault()}>
      <label htmlFor="schedule">Schedule</label>
      <RoutineSuggestionsInput
        id="schedule"
        value={value}
        suggestions={SUGGESTIONS}
        onValueChange={setValue}
        triggerLabel="Show presets"
      />
    </form>
  );
}

// The DOM globals the Radix popover and floating-ui read: everything the JSDOM window has
// that Bun's global object lacks, plus the event classes, which must be JSDOM's own.
const EVENT_CLASSES = [
  'Event',
  'CustomEvent',
  'KeyboardEvent',
  'MouseEvent',
  'FocusEvent',
  'InputEvent',
  'UIEvent',
];
let installed: Map<string, PropertyDescriptor | undefined>;

function installDom() {
  dom = new JSDOM('<!doctype html><div id="root"></div>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });
  const win = dom.window as unknown as Record<string, unknown>;
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  win.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  const names = [
    ...Object.getOwnPropertyNames(dom.window).filter((name) => !(name in globalThis)),
    ...EVENT_CLASSES,
    'window',
    'document',
    'navigator',
    'ResizeObserver',
    'IS_REACT_ACT_ENVIRONMENT',
  ];
  installed = new Map(
    names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  );
  for (const name of names) {
    const value =
      name === 'window'
        ? dom.window
        : name === 'IS_REACT_ACT_ENVIRONMENT'
          ? true
          : typeof win[name] === 'function' && !/^[A-Z]/.test(name)
            ? (win[name] as (...args: unknown[]) => unknown).bind(dom.window)
            : win[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
}

beforeEach(async () => {
  installDom();
  ({ RoutineSuggestionsInput } = await import('./RoutineSuggestionsInput'));
  const { createRoot } = await import('react-dom/client');
  root = createRoot(document.querySelector('#root')!);
  act(() => root.render(<Field />));
});

afterEach(async () => {
  act(() => root.unmount());
  // floating-ui finishes a position it started before the unmount on a later tick.
  await new Promise((resolve) => setTimeout(resolve, 20));
  dom.window.close();
  for (const [name, descriptor] of installed) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

function input() {
  return document.querySelector<HTMLInputElement>('#schedule')!;
}

function type(text: string) {
  const field = input();
  act(() => {
    field.focus();
    const setter = Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype,
      'value',
    )!.set!;
    setter.call(field, text);
    field.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
}

function press(key: string) {
  const event = new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  act(() => {
    input().dispatchEvent(event);
  });
  return event;
}

function options() {
  return [...document.querySelectorAll('[role="option"]')].map((option) => option.textContent);
}

describe('RoutineSuggestionsInput', () => {
  it('is a combobox named by its own label, closed until something is typed', () => {
    const field = input();
    assert.equal(field.getAttribute('role'), 'combobox');
    assert.equal(field.getAttribute('aria-expanded'), 'false');
    assert.equal(field.getAttribute('aria-labelledby'), null);
    assert.equal(field.labels?.[0]?.textContent, 'Schedule');
  });

  it('lists the matching suggestions as options while typing', () => {
    type('every day');
    assert.equal(current, 'every day');
    assert.equal(input().getAttribute('aria-expanded'), 'true');
    assert.deepEqual(options(), ['Every day at 9']);

    // The arrow keys make an option active, and the field points at it.
    type('every');
    assert.deepEqual(options(), ['Every 15 minutes', 'Every day at 9']);
    press('ArrowDown');
    const active = input().getAttribute('aria-activedescendant');
    assert.equal(document.getElementById(active ?? '')?.textContent, 'Every day at 9');
  });

  it('chooses the active suggestion with the arrow keys and Enter', () => {
    type('9');
    assert.deepEqual(options(), ['Weekdays at 9', 'Every day at 9']);
    press('ArrowDown');
    const enter = press('Enter');
    assert.equal(enter.defaultPrevented, true);
    assert.equal(current, '0 9 * * *');
    assert.deepEqual(options(), []);
  });

  it('leaves Enter to the form when no list is open', () => {
    type('0 7 * * *');
    assert.deepEqual(options(), []);
    const enter = press('Enter');
    assert.equal(enter.defaultPrevented, false);
    assert.equal(current, '0 7 * * *');
  });

  it('closes the list on Escape and keeps the typed text', () => {
    type('every');
    assert.equal(options().length, 2);
    press('Escape');
    assert.deepEqual(options(), []);
    assert.equal(current, 'every');
  });
});
