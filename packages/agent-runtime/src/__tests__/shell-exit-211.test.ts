import { expect, test } from 'bun:test';
import { shellTool } from '../tools/shell';

// 122B/211: a command that exits 7 keeps its output and code, and is reported as a
// non-zero exit (shown as "Beendet mit Code 7"), not as a failed tool.
test('shell exit 7 is a non-zero exit that preserves output and code', async () => {
  for (const command of ['exit 7', 'printf partial; exit 7']) {
    const result = await shellTool({ timeoutMs: 1000 }).execute(
      { command },
      { workdir: process.cwd(), env: {}, signal: new AbortController().signal },
    );
    expect(result.isError).toBe(false);
    expect(result.outcome).toBe('nonzero_with_output');
    expect(result.exitCode).toBe(7);
    expect(result.text).toContain('Exit code 7');
    if (command.startsWith('printf')) expect(result.text).toContain('partial');
  }
});
