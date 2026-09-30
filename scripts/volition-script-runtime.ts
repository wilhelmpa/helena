type ScriptContext = {
  progress: (message: string) => void;
  onClose: (close: () => Promise<void>) => void;
};

export async function runVolitionScript(
  name: string,
  apply: boolean,
  run: (context: ScriptContext) => Promise<void>,
): Promise<never> {
  const progress = (message: string) => console.error(`[${name}] ${message}`);
  const closing: (() => Promise<void>)[] = [];
  progress(`Starting ${apply ? 'apply' : 'dry-run'}; loading inputs.`);
  const rawTimeout = process.env.VOLITION_SCRIPT_TIMEOUT_MS ?? '300000';
  const timeoutMs = Number(rawTimeout);
  if (
    !/^\d+$/.test(rawTimeout) ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 900000
  ) {
    progress('VOLITION_SCRIPT_TIMEOUT_MS must be an integer between 1 and 900000.');
    process.exit(1);
  }
  let phase = 'loading inputs';
  const deadline = setTimeout(() => {
    progress(`Hard timeout after ${timeoutMs} ms (${phase}); aborting with exit code 124.`);
    for (const close of closing) void close().catch(() => {});
    process.exit(124);
  }, timeoutMs);
  let code = 0;
  try {
    await run({
      progress: (message) => {
        phase = message;
        progress(message);
      },
      onClose: (close) => closing.push(close),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.split('\n')[0] : 'Unknown error';
    const cause = error instanceof Error && error.cause ? error.cause : error;
    const errorCode =
      cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string'
        ? ` [${cause.code}]`
        : '';
    progress(`Failed (${phase}): ${message}${errorCode}`);
    code = 1;
  } finally {
    phase = 'closing connections';
    progress('Closing connections.');
    for (const close of closing.reverse()) {
      try {
        await close();
      } catch {
        progress('Failed to close a connection.');
        code = 1;
      }
    }
  }
  progress(`Finished with exit code ${code}.`);
  await Promise.all([
    new Promise<void>((resolve) => process.stdout.write('', () => resolve())),
    new Promise<void>((resolve) => process.stderr.write('', () => resolve())),
  ]);
  clearTimeout(deadline);
  process.exit(code);
}
