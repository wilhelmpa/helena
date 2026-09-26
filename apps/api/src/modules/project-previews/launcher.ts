import { createConnection } from 'node:net';

export class PreviewLauncherError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export type PreviewTransport = (
  request: Record<string, unknown>,
  timeoutMs: number,
) => Promise<unknown>;
const MAX_REPLY = 256 * 1024;

// The native launcher's existing length-prefixed framing; no command is run by the API.
export const previewSocketTransport: PreviewTransport = (request, timeoutMs) =>
  new Promise((resolve, reject) => {
    const socket = createConnection({
      path:
        process.env.HELENA_PREVIEW_LAUNCHER_SOCKET || '/run/volition-agent-launcher/launch.sock',
    });
    let buffer = Buffer.alloc(0);
    let settled = false;
    const finish = (error: Error | null, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(
      () =>
        finish(
          new PreviewLauncherError('unavailable', 'The preview service did not answer in time'),
        ),
      timeoutMs,
    );
    socket.once('connect', () => socket.write(JSON.stringify({ ...request, v: 1 }) + '\n'));
    socket.on('error', () =>
      finish(new PreviewLauncherError('unavailable', 'The preview service is unavailable')),
    );
    socket.once('close', () =>
      finish(new PreviewLauncherError('unavailable', 'The preview service closed the connection')),
    );
    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > MAX_REPLY)
        return finish(
          new PreviewLauncherError('unavailable', 'The preview response exceeded its limit'),
        );
      if (buffer.length < 5) return;
      const length = buffer.readUInt32BE(1);
      if (length > MAX_REPLY - 5)
        return finish(
          new PreviewLauncherError('unavailable', 'The preview response exceeded its limit'),
        );
      if (buffer.length < length + 5) return;
      try {
        const answer = JSON.parse(buffer.subarray(5, 5 + length).toString('utf8'));
        if (buffer[0] === 0x15) return finish(null, answer);
        if (buffer[0] === 0x14)
          return finish(
            new PreviewLauncherError(
              String(answer.error || 'unavailable'),
              String(answer.message || 'The preview request was refused'),
            ),
          );
      } catch {
        /* The fixed error below avoids reflecting an untrusted response. */
      }
      finish(
        new PreviewLauncherError('unavailable', 'The preview service returned an invalid response'),
      );
    });
  });
let transport = previewSocketTransport;
export function usePreviewTransport(next: PreviewTransport | null): void {
  transport = next ?? previewSocketTransport;
}
export function previewLauncher<T>(
  request: Record<string, unknown>,
  timeoutMs = 10_000,
): Promise<T> {
  return transport(request, timeoutMs) as Promise<T>;
}
