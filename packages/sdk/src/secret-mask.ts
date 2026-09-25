// Masks known secret values in what a runtime produced, before Helena stores or shows it:
// the values Helena itself handed to an agent (environment variables from Zugänge, the
// secrets of its MCP servers, its own key). Exact matches only; recognising credentials by
// their shape stays with the runner's pattern pass (packages/runner/src/redact.ts). The
// runner masks what it reports, and the API masks again what it stores, with the same
// class, so a value a runner did not know of is still caught (docs/helena-decisions/
// agent-env.md §5).

export const SECRET_MASK = '[redacted]';

// Shorter values are left alone: masking every occurrence of a four-letter word would ruin
// the text and hide nothing.
export const MIN_SECRET_LENGTH = 8;

// A value this long is masked where it appears whole in one piece, but not held back
// across the pieces of a stream: waiting for kilobytes of text would stall the stream, and
// such values (key files, JSON documents) are masked by their shape as well.
const MAX_HELD_SECRET = 4096;

export class SecretMask {
  // Longest first, so a value that contains another is masked whole.
  readonly secrets: readonly string[];
  private readonly held: readonly string[];
  private readonly firstChars: ReadonlySet<string>;

  constructor(values: Iterable<string | null | undefined> = []) {
    const unique = new Set<string>();
    for (const value of values) {
      if (typeof value === 'string' && value.length >= MIN_SECRET_LENGTH) unique.add(value);
    }
    this.secrets = [...unique].sort((a, b) => b.length - a.length);
    this.held = this.secrets.filter((secret) => secret.length <= MAX_HELD_SECRET);
    this.firstChars = new Set(this.held.map((secret) => secret[0]!));
  }

  get empty(): boolean {
    return this.secrets.length === 0;
  }

  // A mask over these values and the other's.
  with(other: SecretMask | Iterable<string>): SecretMask {
    const more = other instanceof SecretMask ? other.secrets : other;
    return new SecretMask([...this.secrets, ...more]);
  }

  text(value: string): string {
    let text = value;
    for (const secret of this.secrets) {
      if (text.includes(secret)) text = text.split(secret).join(SECRET_MASK);
    }
    return text;
  }

  // Every string inside a JSON value; keys are left as they are.
  value<T>(input: T): T {
    if (this.empty) return input;
    return this.walk(input) as T;
  }

  private walk(input: unknown): unknown {
    if (typeof input === 'string') return this.text(input);
    if (Array.isArray(input)) return input.map((item) => this.walk(item));
    if (input && typeof input === 'object') {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>).map(([key, item]) => [
          key,
          this.walk(item),
        ]),
      );
    }
    return input;
  }

  // For text that arrives in pieces, such as a chat answer's deltas.
  stream(): SecretStream {
    return new SecretStream(this);
  }

  // How much of the end of `text` could still turn into a secret with what comes next: the
  // longest ending that is the start of a secret without being all of it.
  holdback(text: string): number {
    if (this.held.length === 0) return 0;
    const longest = this.held[0]!.length;
    for (let start = Math.max(0, text.length - longest + 1); start < text.length; start++) {
      if (!this.firstChars.has(text[start]!)) continue;
      const ending = text.slice(start);
      if (this.held.some((secret) => secret.length > ending.length && secret.startsWith(ending))) {
        return ending.length;
      }
    }
    return 0;
  }
}

// Masks a text that arrives in pieces. A value split across two pieces is still masked:
// whatever could be the start of one is held back until the next piece shows whether it is.
// `end` gives back what is held.
export class SecretStream {
  private pending = '';

  constructor(private readonly mask: SecretMask) {}

  push(piece: string): string {
    if (this.mask.empty) return piece;
    const text = this.mask.text(this.pending + piece);
    const keep = this.mask.holdback(text);
    this.pending = keep > 0 ? text.slice(text.length - keep) : '';
    return keep > 0 ? text.slice(0, text.length - keep) : text;
  }

  end(): string {
    const rest = this.mask.text(this.pending);
    this.pending = '';
    return rest;
  }
}
