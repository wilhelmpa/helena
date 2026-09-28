import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { LocalAiSettings } from '@/lib/api/endpoints/localAi';
import { loadFacts, newServerForm, serverInput, type ServerForm } from './serverForm';

function settings(servers = 0): LocalAiSettings {
  return {
    policy: {
      enabled: false,
      units: { gpu: true, npu: true, cpu: true },
      classes: {},
      preset: 'ausgewogen',
      initialized: false,
    },
    servers: Array.from({ length: servers }, () => ({}) as LocalAiSettings['servers'][number]),
    serverTypes: [
      {
        id: 'lemonade',
        label: 'Lemonade',
        defaultBaseUrl: 'http://127.0.0.1:13305/api/v1',
        defaultKeySource: 'file',
        capabilitiesConfigurable: false,
      },
      {
        id: 'halogen',
        label: 'Halogen',
        defaultBaseUrl: 'http://127.0.0.1:8731/v1',
        defaultKeySource: 'none',
        capabilitiesConfigurable: true,
      },
    ],
    classes: [],
    evals: [],
    runningEvals: [],
  };
}

describe('the model server form', () => {
  it('starts a kind with its own address and key source', () => {
    const halogen = newServerForm(settings(1), 'halogen');
    assert.equal(halogen.baseUrl, 'http://127.0.0.1:8731/v1');
    assert.equal(halogen.keySource, 'none');
    assert.equal(halogen.slug, 'halogen');
    assert.equal(halogen.capabilities, null);
    const first = newServerForm(settings(0), 'lemonade');
    assert.equal(first.slug, 'local');
    assert.equal(first.keySource, 'file');
  });

  it('sends a new server with its short name, kind and capabilities', () => {
    const form: ServerForm = {
      ...newServerForm(settings(1), 'halogen'),
      name: ' Halogen ',
      contextLength: '131072',
      capabilities: ['vision', 'tools'],
    };
    assert.deepEqual(serverInput(form, true, false), {
      slug: 'halogen',
      kind: 'halogen',
      name: 'Halogen',
      baseUrl: 'http://127.0.0.1:8731/v1',
      keySource: 'none',
      keyFile: null,
      contextLength: 131072,
      options: { capabilities: ['tools', 'vision'] },
    });
  });

  it('changes a server without its short name, and keeps a stored key it leaves empty', () => {
    const form: ServerForm = {
      ...newServerForm(settings(1), 'lemonade'),
      keySource: 'stored',
      key: '',
      contextLength: '',
    };
    const input = serverInput(form, false, true);
    assert.equal('slug' in input, false);
    assert.equal('kind' in input, false);
    assert.equal('key' in input, false);
    assert.equal('contextLength' in input, false);
    assert.equal('options' in input, false);
  });

  it('sends null to go back to what the server says', () => {
    const form = { ...newServerForm(settings(1), 'halogen'), capabilities: null };
    assert.deepEqual(serverInput(form, true, true).options, { capabilities: null });
  });
});

describe('the load line', () => {
  it('names only what the server counts, in order', () => {
    assert.deepEqual(
      loadFacts({
        gpuPercent: 97,
        npuPercent: null,
        cpuPercent: null,
        vramGb: null,
        memoryGb: 110.4,
        outputTokensPerSecond: 40,
        promptTokensPerSecond: 1440,
        slots: 2,
        busySlots: 1,
        queued: 0,
        kvUsagePercent: 12.5,
      }).map((fact) => fact.kind),
      ['speed', 'slots', 'memory', 'kv', 'gpu'],
    );
    assert.deepEqual(
      loadFacts({
        gpuPercent: null,
        npuPercent: 3,
        cpuPercent: 10,
        vramGb: 20,
        memoryGb: null,
      }),
      [],
    );
    assert.deepEqual(loadFacts(null), []);
  });
});
