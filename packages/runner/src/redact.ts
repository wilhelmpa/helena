import { lintSource } from '@secretlint/core';
import { creator as recommendedRules } from '@secretlint/secretlint-rule-preset-recommend';

// Masks secrets in what the runner sends Helena about a run: the exact values the runner
// handed to the agent (its API key, the secrets its MCP servers name), and whatever
// secretlint's recommended rules recognise as a credential. Hermes' own transcripts and logs
// are already redacted by Hermes; this pass covers the output of every runtime.

export const MASK = '[redacted]';

// Shorter values are left alone: masking every occurrence of a four-letter word would ruin
// the text and hide nothing.
const MIN_KNOWN_LENGTH = 8;
// Below this length no credential secretlint knows fits, so the text is not scanned.
const MIN_SCAN_LENGTH = 16;

// What secretlint's preset does not name: API keys in the common `sk-` form, bearer tokens,
// and private key blocks of any length.
const PATTERNS = [
  /\bsk-[A-Za-z0-9][A-Za-z0-9_-]{19,}/g,
  /\b(bearer)\s+[A-Za-z0-9._~+/=-]{16,}/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

const RULES = [{ id: '@secretlint/secretlint-rule-preset-recommend', rule: recommendedRules }];

export class Redactor {
  private readonly known: string[];

  constructor(known: Iterable<string> = []) {
    // Longest first, so a value that contains another is masked whole.
    this.known = [...new Set([...known].filter((value) => value.length >= MIN_KNOWN_LENGTH))].sort(
      (a, b) => b.length - a.length,
    );
  }

  // The exact values it masks, for a helper that redacts in another process.
  secrets(): string[] {
    return [...this.known];
  }

  async text(value: string): Promise<string> {
    let text = value;
    for (const secret of this.known) {
      if (text.includes(secret)) text = text.split(secret).join(MASK);
    }
    for (const pattern of PATTERNS) {
      text = text.replace(pattern, (_match, bearer?: string) =>
        typeof bearer === 'string' && /^bearer$/i.test(bearer) ? `${bearer} ${MASK}` : MASK,
      );
    }
    if (text.length < MIN_SCAN_LENGTH) return text;
    const result = await lintSource({
      source: { filePath: '/runner-output.txt', content: text, contentType: 'text' },
      options: { config: { rules: RULES }, maskSecrets: false },
    });
    const ranges = result.messages.map((message) => message.range).sort((a, b) => b[0] - a[0]);
    for (const [start, end] of ranges) {
      text = `${text.slice(0, start)}${MASK}${text.slice(end)}`;
    }
    return text;
  }

  // Every string inside a JSON value, keys left as they are.
  async value<T>(input: T): Promise<T> {
    if (typeof input === 'string') return (await this.text(input)) as T;
    if (Array.isArray(input))
      return (await Promise.all(input.map((item) => this.value(item)))) as T;
    if (input && typeof input === 'object') {
      const entries = await Promise.all(
        Object.entries(input as Record<string, unknown>).map(
          async ([key, item]) => [key, await this.value(item)] as const,
        ),
      );
      return Object.fromEntries(entries) as T;
    }
    return input;
  }
}
