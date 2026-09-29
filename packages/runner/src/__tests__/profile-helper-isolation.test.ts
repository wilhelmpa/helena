import { describe, expect, it } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The launcher starts the profile helper (cli.ts `profile-helper`) with an empty environment,
// as the project's user, only for isolated agents. What it writes must be what the isolated
// agent reaches: Halogen at 8731, which the sandbox forwards to the priority proxy's socket,
// never the host's 8741 (29.09.: every isolated agent on Flash hung in connection retries).
describe('the profile helper', () => {
  it('writes the isolated addresses although its environment is empty', async () => {
    const home = await mkdtemp(join(tmpdir(), 'profile-helper-'));
    try {
      const child = Bun.spawn(
        [process.execPath, join(import.meta.dir, '..', 'cli.ts'), 'profile-helper'],
        {
          env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HERMES_HOME: home },
          stdin: 'pipe',
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
      child.stdin.write(
        JSON.stringify({
          op: 'materialize',
          snapshot: {
            revision: 'r1',
            runtimePolicy: { files: [] },
            skills: [],
            localAi: {
              servers: [
                {
                  provider: 'helena-halogen',
                  baseUrl: 'http://127.0.0.1:8731/v1',
                  noThinkingBaseUrl: 'http://127.0.0.1:8733/v1',
                  keyEnv: null,
                  contextLength: 131072,
                  models: [{ id: 'flash', contextLength: null, vision: false }],
                },
              ],
              helpers: [],
            },
          },
          options: {},
        }),
      );
      child.stdin.end();
      const [out, err] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      await child.exited;
      expect({ out, err, code: child.exitCode }).toMatchObject({ code: 0 });
      const config = await readFile(join(home, 'run', 'itsaplan-managed', 'config.yaml'), 'utf8');
      expect(config).toContain('http://127.0.0.1:8731/v1');
      expect(config).toContain('http://127.0.0.1:8733/v1');
      expect(config).not.toContain(':8741');
      expect(config).not.toContain(':8743');
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  }, 30_000);
});
