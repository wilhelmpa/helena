import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { act, type ReactNode } from 'react';
import type { Root } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { JSDOM } from 'jsdom';
import routines from '../../../../messages/en/routines.json';
import pipelines from '../../../../messages/en/pipelines.json';
import type { RoutineMention } from '@/lib/api/endpoints/routines';
import type { PipelineRunStep } from '@/lib/api/endpoints/pipelines';
import PipelineRunStepItem from '@/components/common/pipeline-runs/PipelineRunStepItem';
import { RoutineMentionList, RoutineMentionsLine } from './RoutineMentions';

// The agents a routine's instructions mention: which a run starts, and why one does not —
// in the editor, in the list, and in the run history under the fire's dispatch step.

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

const MENTIONS: RoutineMention[] = [
  { agent: { id: 2, name: 'Coder', username: 'coder' }, starts: true, reason: null },
  { agent: { id: 3, name: 'Content SEO', username: 'seo' }, starts: true, reason: null },
  { agent: { id: 4, name: 'Private', username: 'private' }, starts: false, reason: 'owner-only' },
];

function render(node: ReactNode) {
  act(() =>
    root.render(
      <NextIntlClientProvider locale="en" messages={{ routines, pipelines }} timeZone="UTC">
        {node}
      </NextIntlClientProvider>,
    ),
  );
  return document.querySelector('#root')!.textContent ?? '';
}

function part(overrides: Partial<PipelineRunStep>): PipelineRunStep {
  return {
    stepId: 'dispatch.m2',
    parentStepId: 'dispatch',
    iteration: 1,
    seq: 1,
    kind: 'delegate',
    name: 'Coder',
    status: 'succeeded',
    outcome: 'mention-started',
    summary: null,
    attempt: 1,
    agent: { id: 2, username: 'coder', name: 'Coder' },
    agentRun: { id: 41, status: 'running', inputTokens: null, outputTokens: null },
    decidedByName: null,
    note: null,
    wakeAt: null,
    error: null,
    failure: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    ...overrides,
  } as PipelineRunStep;
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

describe('routine mentions', () => {
  it('lists each mentioned agent with whether a run starts it, and why not', () => {
    const text = render(<RoutineMentionList mentions={MENTIONS} />);
    assert.match(text, /Mentioned agents/);
    assert.match(text, /Coder @coder · starts on every run/);
    assert.match(text, /Private @private · takes tasks only from its owner/);
  });

  it('sums them up in one line of the list, counting the ones that start nobody', () => {
    const text = render(<RoutineMentionsLine mentions={MENTIONS} />);
    assert.match(text, /Also starts Coder, Content SEO/);
    assert.match(text, /1 mention starts nobody/);
    assert.equal(render(<RoutineMentionsLine mentions={[]} />), '');
  });

  it('names a started agent in the run history by its run, a refused one by the reason', () => {
    const started = render(<PipelineRunStepItem step={part({})} />);
    assert.match(started, /Mentioned in the instructions/);
    assert.match(started, /Started/);
    assert.doesNotMatch(started, /Succeeded|Done/);
    const refused = render(
      <PipelineRunStepItem
        step={part({
          stepId: 'dispatch.m4',
          status: 'skipped',
          outcome: 'mention-owner-only',
          agent: { id: 4, username: 'private', name: 'Private' },
          agentRun: null,
        })}
      />,
    );
    assert.match(refused, /Skipped/);
    assert.match(refused, /Takes tasks only from its owner/);
  });
});
