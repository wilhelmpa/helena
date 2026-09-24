import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { RuntimeSync } from '@/lib/api/endpoints/agentRuntimeSync';
import { driftServer, profileServers, syncStatus } from './agentProfileSync';

describe('profile sync', () => {
  it('shows a synced profile green, drift and catching up amber, a failed apply red', () => {
    assert.equal(syncStatus('synced'), 'success');
    assert.equal(syncStatus('drift'), 'waiting');
    assert.equal(syncStatus('pending'), 'waiting');
    assert.equal(syncStatus('degraded'), 'danger');
    assert.equal(syncStatus('offline'), 'idle');
    assert.equal(syncStatus('unknown'), 'idle');
  });

  it('names the server of an MCP drift and nothing for a setting', () => {
    assert.equal(
      driftServer({ key: 'mcp_servers.browser-harness', code: 'mcp-differs' }),
      'browser-harness',
    );
    assert.equal(driftServer({ key: 'memory.memory_enabled', code: 'setting-differs' }), null);
  });

  it("lists Helena's servers apart from the runtime's own that Helena turned off", () => {
    const sync = {
      profile: {
        mcpServers: [
          { name: 'itsaplan', enabled: true, managed: true },
          { name: 'old-tool', enabled: false, managed: false },
        ],
      },
    } as RuntimeSync;
    assert.deepEqual(profileServers(sync), { managed: ['itsaplan'], turnedOff: ['old-tool'] });
    assert.deepEqual(profileServers(undefined), { managed: [], turnedOff: [] });
  });
});
