import { expect, test } from 'bun:test';
import { shellTool } from '../tools/shell';

test('shell exit 7 is a failed tool result and preserves output and code', async () => {
  for (const command of ['exit 7', 'printf partial; exit 7']) {
    const result = await shellTool({ timeoutMs: 1000 }).execute(
      { command },
      { workdir: process.cwd(), env: {}, signal: new AbortController().signal },
    );
    expect(result.isError).toBe(true);
    expect(result.exitCode).toBe(7);
    expect(result.text).toContain('Exit code 7');
    if (command.startsWith('printf')) expect(result.text).toContain('partial');
  }
});
