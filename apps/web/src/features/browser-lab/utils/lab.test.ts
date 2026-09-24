import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { LabOptions } from '@/lib/api/endpoints/browserTask';
import { confidenceOf, connectionLabel, emptyDraft, toStartRun, valuesOf } from './lab';

const options: LabOptions = {
  agents: [{ id: 7, name: 'Coordinator', username: 'vol' }],
  connections: [
    {
      id: 3,
      label: 'Laya lokal',
      provider: 'compatible',
      model: 'laya-browser',
      baseUrl: 'http://127.0.0.1:8791',
      keySource: 'local-laya',
      hasKey: true,
      status: 'ok',
    },
  ],
  defaultConnectionId: 3,
  controlEnabled: true,
  slug: 'vol',
};

describe('Browser 2.0 form', () => {
  it('starts with the first agent and the default connection', () => {
    const draft = emptyDraft(options);
    assert.equal(draft.agentId, 7);
    assert.equal(draft.backend, 'decision:3');
    assert.equal(emptyDraft({ ...options, defaultConnectionId: null }).backend, 'standard');
  });

  it('reads one value per line and ignores lines without a name', () => {
    assert.deepEqual(valuesOf('email: max@example.com\n: nothing\nno colon\nname:  Max Muster '), {
      email: 'max@example.com',
      name: 'Max Muster',
    });
    // A value may itself contain a colon (an address with a port).
    assert.deepEqual(valuesOf('url: http://example.com:8080'), { url: 'http://example.com:8080' });
  });

  it('builds the request for a decision model run', () => {
    const body = toStartRun({
      ...emptyDraft(options),
      goal: '  Suche nach Helena ',
      values: 'q: Helena',
      maxSteps: '99',
      policy: 'laya',
    });
    assert.deepEqual(body, {
      backend: 'decision',
      agentId: 7,
      credentialId: 3,
      policy: 'laya',
      goal: 'Suche nach Helena',
      values: { q: 'Helena' },
      startUrl: null,
      mode: 'act',
      maxSteps: 60,
    });
  });

  it('refuses an empty task, and jev-browser without a start address', () => {
    assert.equal(toStartRun({ ...emptyDraft(options), goal: '   ' }), null);
    const jev = { ...emptyDraft(options), goal: 'Lies die Überschrift', backend: 'jev-browser:3' };
    assert.equal(toStartRun(jev), null);
    const started = toStartRun({ ...jev, startUrl: 'https://example.com' });
    assert.equal(started?.backend, 'jev-browser');
    assert.equal(started?.credentialId, 3);
    assert.equal(started && 'policy' in started, false);
  });

  it('sends Standard without a connection', () => {
    const body = toStartRun({
      ...emptyDraft(options),
      goal: 'x',
      backend: 'standard',
      maxSteps: '',
    });
    assert.equal(body?.backend, 'standard');
    assert.equal(body && 'credentialId' in body, false);
    assert.equal(body?.maxSteps, 20);
  });
});

describe('browser control settings', () => {
  it('reads a threshold as typed', () => {
    assert.equal(confidenceOf(''), null);
    assert.equal(confidenceOf('0,4'), 0.4);
    assert.equal(confidenceOf('0.15'), 0.15);
    assert.equal(confidenceOf('1'), undefined);
    assert.equal(confidenceOf('abc'), undefined);
  });

  it('names a connection with its model', () => {
    assert.equal(connectionLabel(options.connections[0]!), 'Laya lokal · laya-browser');
    assert.equal(connectionLabel({ ...options.connections[0]!, model: null }), 'Laya lokal');
  });
});
