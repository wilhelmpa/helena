import type { ResultEvent } from '@helena/agent-runtime';

export class NativeResultReader {
  private buffered = '';
  private oversized = false;
  result: ResultEvent | null = null;

  write(chunk: string): void {
    const lines = chunk.split('\n');
    for (let index = 0; index < lines.length; index++) {
      if (!this.oversized) {
        this.buffered += lines[index];
        if (this.buffered.length > 1_048_576) {
          this.buffered = '';
          this.oversized = true;
        }
      }
      if (index < lines.length - 1) this.end();
    }
  }

  end(): void {
    if (!this.oversized && this.buffered) this.read(this.buffered);
    this.buffered = '';
    this.oversized = false;
  }

  private read(line: string): void {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      return;
    }
    if (!value || typeof value !== 'object') return;
    const event = value as Partial<ResultEvent>;
    if (
      event.type !== 'result' ||
      typeof event.text !== 'string' ||
      typeof event.exitCode !== 'number' ||
      !Number.isInteger(event.exitCode)
    )
      return;
    this.result = {
      type: 'result',
      text: event.text,
      exitCode: event.exitCode,
      ...(typeof event.reason === 'string' && { reason: event.reason }),
      ...(typeof event.error === 'string' && { error: event.error }),
    };
  }
}
