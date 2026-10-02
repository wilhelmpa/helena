import { expect, test } from 'bun:test';
import catalog from '../../../scripts/tool-regression/catalog.json';
import { BROWSER_TOOLS } from './tools';
import { GatewayDispatcher } from './server';
import { ProjectBrowserLocks } from './lock';
import {
  fakeHelenaClient,
  fakeSession,
  fakeSessions,
  resolved,
} from './__tests__/fixtures/gateway';
import { contactSite } from './task/fake-site';
import { mockAnswers } from './task/mock-backend';
import type { DecisionRequest } from './task/systemone';

const inputs: Record<string, Record<string, unknown>> = {
  browser_acquire: {},
  browser_check: { question: 'Is the ABSCHLUSSTEST contact link visible?' },
  browser_choose: { question: 'Which contact link?', options: ['Kontakt', 'Home'] },
  browser_click: { target: 'e1' },
  browser_console_messages: {},
  browser_downloads: {},
  browser_drag: { startTarget: 'e1', endTarget: 'e2' },
  browser_file_upload: {},
  browser_fill_form: {
    fields: [{ target: 'e1', name: 'ABSCHLUSSTEST', type: 'textbox', value: 'ABSCHLUSSTEST' }],
  },
  browser_find: { text: 'ABSCHLUSSTEST' },
  browser_handle_dialog: { accept: false },
  browser_handover: { reason: 'ABSCHLUSSTEST synthetic owner' },
  browser_hover: { target: 'e1' },
  browser_login: { usernameTarget: 'e1', passwordTarget: 'e2' },
  browser_login_code: { target: 'e1', credentialId: 1 },
  browser_navigate: { url: 'https://example.com/' },
  browser_navigate_back: {},
  browser_network_requests: {},
  browser_press_key: { key: 'Tab' },
  browser_release: {},
  browser_reload: {},
  browser_scroll: { direction: 'down' },
  browser_select_option: { target: 'e1', values: ['ABSCHLUSSTEST'] },
  browser_snapshot: {},
  browser_status: {},
  browser_tabs: { action: 'list' },
  browser_take_screenshot: {},
  browser_task: { goal: 'ABSCHLUSSTEST open Kontakt', maxSteps: 1 },
  browser_type: { target: 'e1', text: 'ABSCHLUSSTEST' },
  browser_wait_for: { time: 0 },
};

test('every registered browser tool has an explicit executable fixture', () => {
  expect(BROWSER_TOOLS.map((tool) => tool.name).sort()).toEqual(catalog.browser);
  expect(Object.keys(inputs).sort()).toEqual(catalog.browser);
});

for (const name of catalog.browser) {
  test(`${name}: valid input, invalid input and foreign project through the dispatcher`, async () => {
    const locks = new ProjectBrowserLocks(120_000);
    const helena = fakeHelenaClient({
      resolve: async () =>
        resolved({
          browserTask: { enabled: true, policy: 'jev', minConfidence: null, label: 'Fixture' },
        }),
      login: async () => ({
        status: 'filled',
        login: {
          id: 1,
          label: 'ABSCHLUSSTEST',
          username: 'ABSCHLUSSTEST',
          password: 'synthetic-fixture',
          has2fa: false,
        },
      }),
      taskStart: async () => ({
        taskId: 1,
        taskToken: 'ABSCHLUSSTEST',
        policy: 'jev',
        minConfidence: null,
        label: 'Fixture',
        model: 'fixture',
      }),
      systemOne: async (request: DecisionRequest) => ({
        answers: mockAnswers(request).answers,
        model: 'fixture',
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
      }),
      taskFinish: async () => {},
    });
    const gateway = new GatewayDispatcher({
      ownSlug: 'abschlusstest',
      helena,
      locks,
      sessions: fakeSessions(
        fakeSession({ taskPage: () => contactSite(), agentSnapshot: async () => 'ABSCHLUSSTEST' }),
      ),
      lookupHost: async () => [{ address: '93.184.216.34' }],
    });
    await gateway.handle({ tool: 'browser_acquire', agentKey: 'ABSCHLUSSTEST' });
    const good = gateway.handle({
      tool: name,
      agentKey: 'ABSCHLUSSTEST',
      args: inputs[name],
      ...(name === 'browser_file_upload'
        ? {
            uploads: [
              { name: 'ABSCHLUSSTEST.txt', data: Buffer.from('ABSCHLUSSTEST').toString('base64') },
            ],
          }
        : {}),
    });
    if (name === 'browser_handover') {
      await Bun.sleep(10);
      locks.of('abschlusstest').takeover();
      locks.of('abschlusstest').release({ kind: 'owner' });
    }
    const valid = await good;
    expect(valid).toMatchObject({ ok: true });
    if (valid.ok) expect(typeof valid.content).toBe('string');

    const foreign = await gateway.handle({
      tool: name,
      agentKey: 'ABSCHLUSSTEST',
      args: { ...inputs[name], project: 'FOREIGN' },
    });
    expect(foreign).toMatchObject({ ok: false, error: expect.stringContaining('Home-Master') });

    const invalid = await gateway.handle({
      tool: name,
      agentKey: 'ABSCHLUSSTEST',
      args: { ...inputs[name], project: [] },
    });
    expect(invalid).toMatchObject({ ok: false, error: expect.stringContaining('project') });
  });
}
