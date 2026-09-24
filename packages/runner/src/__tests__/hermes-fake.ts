import { readFile, readlink } from 'node:fs/promises';
import { join } from 'node:path';
import { deepMerge } from '../contributions';
import { leaves, maskEntry, type HermesProbe } from '../hermes-profile';
import type { HermesReader } from '../policy';
import type { SessionFacts } from '../runtime';

// A stand-in for Hermes' own reading of a home, for the tests: the shared configuration is
// `shared` (what the home's config.yaml would say), the managed one is the file the runner
// wrote, merged the way Hermes merges them. Each field can be changed between checks.
export interface FakeHermes extends HermesReader {
  shared: Record<string, Record<string, unknown>>;
  settings: Record<string, unknown>;
  approvals: HermesProbe['approvals'];
  security: HermesProbe['security'];
  // Hermes ignores a managed configuration it cannot read.
  ignoreManaged: boolean;
  sessions: Map<string, SessionFacts>;
  probes: number;
}

export function fakeHermes(shared: Record<string, Record<string, unknown>> = {}): FakeHermes {
  const fake: FakeHermes = {
    shared,
    settings: {},
    approvals: { singleQueryMode: 'approve', plugins: ['plan-approval-guard'] },
    security: { tirithEnabled: true, tirithFailOpen: false },
    ignoreManaged: false,
    sessions: new Map(),
    probes: 0,
    async probe(home, managedDir, keys) {
      fake.probes++;
      let managed: Record<string, unknown> = {};
      try {
        managed = JSON.parse(await readFile(join(managedDir, 'config.yaml'), 'utf8'));
      } catch {
        managed = {};
      }
      if (fake.ignoreManaged) managed = {};
      const pinned = (managed.mcp_servers ?? {}) as Record<string, Record<string, unknown>>;
      const servers: HermesProbe['mcpServers'] = {};
      for (const name of new Set([...Object.keys(fake.shared), ...Object.keys(pinned)])) {
        const entry = deepMerge(fake.shared[name] ?? {}, pinned[name] ?? {});
        servers[name] = {
          enabled: entry.enabled !== false,
          entry: maskEntry(entry) as Record<string, unknown>,
        };
      }
      const { mcp_servers: _servers, ...settings } = deepMerge(fake.settings, managed);
      const values = Object.fromEntries(leaves(settings));
      const link = await readlink(join(home, 'config.yaml')).catch(() => null);
      return {
        configLink: link,
        configExists: link !== null,
        managedLoaded: Object.keys(managed).length > 0,
        sharedMcpServers: Object.keys(fake.shared).sort(),
        mcpServers: servers,
        values: Object.fromEntries(keys.map((key) => [key, values[key] ?? null])),
        defaults: { model: 'gpt-test', provider: 'test-provider', reasoning: 'low' },
        approvals: fake.approvals,
        security: fake.security,
      };
    },
    async session(_home, sessionId) {
      return fake.sessions.get(sessionId) ?? null;
    },
  };
  return fake;
}
