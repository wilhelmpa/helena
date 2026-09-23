import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { act } from 'react';
import type { Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { JSDOM } from 'jsdom';
import settings from '../../../../../messages/en/settings.json';
import type { ProjectSetupJob } from '@/lib/api/endpoints/projects';
import { RelativeTimeProvider } from '@/context/relativeTimeContext';
import SettingsSetupJobRow from './SettingsSetupJobRow';

const replacedGlobals = [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'IS_REACT_ACT_ENVIRONMENT',
] as const;
let dom: JSDOM;
let root: Root;
let retries: number;
let originalGlobalDescriptors: Map<string, PropertyDescriptor | undefined>;

const failed: ProjectSetupJob = {
  id: '123e4567-e89b-42d3-a456-426614174000',
  status: 'failed',
  attempts: 8,
  lastError: 'HTTP 500',
  updatedAt: new Date().toISOString(),
};

function render(job: ProjectSetupJob | null, canRetry: boolean) {
  act(() =>
    root.render(
      <NextIntlClientProvider locale="en" messages={{ settings }} timeZone="UTC">
        <RelativeTimeProvider>
          <SettingsSetupJobRow
            title="Project setup"
            description="Creates the workspace."
            job={job}
            canRetry={canRetry}
            retrying={false}
            onRetry={() => {
              retries += 1;
            }}
          />
        </RelativeTimeProvider>
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
  retries = 0;
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

describe('SettingsSetupJobRow', () => {
  it('shows a failed job with its attempts and error and retries it on request', () => {
    render(failed, true);
    const text = document.body.textContent ?? '';
    assert.match(text, /Failed/);
    assert.match(text, /8 attempts/);
    assert.match(text, /Last error: HTTP 500/);
    const button = document.querySelector('button');
    assert.equal(button?.textContent, 'Retry');
    act(() => button?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    assert.equal(retries, 1);
  });

  it('offers no retry to a reader who may not run it or for a job that has not failed', () => {
    render(failed, false);
    assert.equal(document.querySelector('button'), null);
    render({ ...failed, status: 'succeeded', lastError: null }, true);
    assert.equal(document.querySelector('button'), null);
    assert.match(document.body.textContent ?? '', /Done/);
  });

  it('says when the project has no setup job', () => {
    render(null, true);
    assert.match(document.body.textContent ?? '', /No setup job exists for this project/);
  });
});
