// What a fact may be (the same rules as the reflection's): short, not obvious, never a secret.
// The secret check is conservative: a fact that looks like it holds a key is refused, the
// agent can state the fact without the value.

export const MAX_FACT_CHARS = 500;

const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(sk|pk|rk)[-_](live|test|proj|ant)?[-_]?[A-Za-z0-9_-]{16,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /\b(pass(wort|word)?|pwd|kennwort|token|api[_ -]?key|secret|geheimnis)\s*[:=]\s*\S{4,}/i,
  /\b[A-Fa-f0-9]{40,}\b/,
  /\b[A-Za-z0-9+/]{48,}={0,2}(?![A-Za-z0-9+/])/,
];

export function looksSecret(text: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

// Why a fact is refused, or null.
export function refuseFact(content: string): string | null {
  const text = content.trim();
  if (!text) return 'The fact is empty.';
  if (text.length > MAX_FACT_CHARS)
    return `A fact has at most ${MAX_FACT_CHARS} characters; split it.`;
  if (looksSecret(text))
    return 'The fact looks like it holds a secret. Store facts without keys, passwords or tokens.';
  return null;
}
