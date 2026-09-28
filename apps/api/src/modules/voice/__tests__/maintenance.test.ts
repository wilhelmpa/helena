import { expect, it } from 'bun:test';
import { fileURLToPath } from 'node:url';

it('holds admission through response completion and refuses busy or uncertain recovery', async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      fileURLToPath(new URL('./fixtures/maintenance.fixture.ts', import.meta.url)),
    ],
    {
      cwd: process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect({ code, stderr }).toEqual({ code: 0, stderr: '' });
  expect(stdout).toContain('voice admission lifecycle: PASS');
});
