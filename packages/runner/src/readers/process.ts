import { spawn } from 'node:child_process';

export interface CommandResult {
  code: number | null;
  stdout: string;
  // Cut to the last few kilobytes: it only says why a command failed.
  stderr: string;
  // Stdout grew past the limit and was cut.
  overflow: boolean;
}

// Runs one command of the runtime to completion with a deadline and a cap on its output. A
// command that outlives the deadline is killed, which the result reports as code null.
export function runCommand(
  bin: string,
  args: string[],
  options: {
    env: Record<string, string>;
    cwd?: string | null;
    stdin?: string;
    timeoutMs: number;
    maxBytes: number;
  },
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      env: options.env,
      cwd: options.cwd ?? undefined,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: options.timeoutMs,
      killSignal: 'SIGKILL',
    });
    const chunks: Buffer[] = [];
    let size = 0;
    let overflow = false;
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      if (overflow) return;
      if (size + chunk.length > options.maxBytes) {
        chunks.push(chunk.subarray(0, options.maxBytes - size));
        overflow = true;
        return;
      }
      size += chunk.length;
      chunks.push(chunk);
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-4000);
    });
    child.stdin.on('error', () => {});
    child.on('error', reject);
    child.on('close', (code) =>
      resolve({ code, stdout: Buffer.concat(chunks).toString('utf8'), stderr, overflow }),
    );
    child.stdin.end(options.stdin ?? '');
  });
}

// Terminal colours and cursor codes, which a command prints for people.
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
}
