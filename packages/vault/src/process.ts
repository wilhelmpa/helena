export interface ProgramResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  // stdout reached maxBytes and the program was stopped there.
  truncated: boolean;
}

async function readLimited(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
  onLimit: () => void,
): Promise<{ text: string; truncated: boolean }> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const room = maxBytes - size;
    if (value.length >= room) {
      chunks.push(value.subarray(0, room));
      size = maxBytes;
      onLimit();
      await reader.cancel().catch(() => undefined);
      return { text: Buffer.concat(chunks).toString('utf8'), truncated: true };
    }
    chunks.push(value);
    size += value.length;
  }
  return { text: Buffer.concat(chunks).toString('utf8'), truncated: false };
}

// Runs a program without a shell and collects its output, bounded in time and size.
export async function runProgram(
  argv: string[],
  options: { cwd?: string; timeoutMs: number; maxBytes?: number },
): Promise<ProgramResult> {
  const child = Bun.spawn(argv, {
    cwd: options.cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, LC_ALL: 'C.UTF-8' },
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, options.timeoutMs);
  try {
    const [stdout, stderr] = await Promise.all([
      readLimited(child.stdout, options.maxBytes ?? 8 * 1024 * 1024, () => child.kill('SIGKILL')),
      readLimited(child.stderr, 64 * 1024, () => undefined),
    ]);
    const code = await child.exited;
    return {
      code,
      stdout: stdout.text,
      stderr: stderr.text,
      timedOut,
      truncated: stdout.truncated,
    };
  } finally {
    clearTimeout(timer);
  }
}

// Whether a program is on the PATH. Read each time: an administrator may install it
// while the worker runs.
export function hasProgram(name: string): boolean {
  return Bun.which(name, { PATH: process.env.PATH ?? '' }) !== null;
}
