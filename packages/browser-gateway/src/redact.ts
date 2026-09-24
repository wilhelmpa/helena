// Design §6: "Jede Ausgabe dieser Session (Snapshot, Konsole, Netzwerk, Fehlermeldungen)
// wird auf den Klartext des Passworts geprüft und geschwärzt." A session tracks every
// secret value the gateway has handled (a login's password, never its TOTP secret — that
// never reaches this process, only the current code, which is tracked too) and scrubs every
// piece of text a tool would otherwise return, so a secret cannot come back to the agent
// through a snapshot, a console line, a network summary or an error message, however it got
// onto the page (typed by the gateway, revealed by a "show password" toggle, echoed into an
// error).

const MASK = '[REDACTED]';
// Below this length a "secret" is too common a substring (a short password, an empty TOTP
// digit run) to redact without mangling unrelated text; the design's own worked values
// (RFC 6238 test codes, generated passwords) are always longer than this.
const MIN_SECRET_LENGTH = 3;

export class SecretGuard {
  #secrets = new Set<string>();

  // Called once a secret value is about to be typed into the page, or a code just
  // computed — before either reaches Chromium, so a leak the very next tool call reads
  // back is still caught.
  track(value: string | null | undefined): void {
    if (value && value.length >= MIN_SECRET_LENGTH) this.#secrets.add(value);
  }

  forget(value: string | null | undefined): void {
    if (value) this.#secrets.delete(value);
  }

  clear(): void {
    this.#secrets.clear();
  }

  hasSecrets(): boolean {
    return this.#secrets.size > 0;
  }

  // Longest secrets first, so one that is a substring of another (rare, but a TOTP code
  // could coincide with digits inside a longer password) does not leave a partial residue.
  #ordered(): string[] {
    return [...this.#secrets].sort((a, b) => b.length - a.length);
  }

  redact(text: string): string {
    if (!text || this.#secrets.size === 0) return text;
    let out = text;
    for (const secret of this.#ordered()) {
      if (!secret) continue;
      out = out.split(secret).join(MASK);
    }
    return out;
  }

  redactDeep<T>(value: T): T {
    if (!this.hasSecrets()) return value;
    if (typeof value === 'string') return this.redact(value) as T;
    if (Array.isArray(value)) return value.map((item) => this.redactDeep(item)) as T;
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        out[key] = this.redactDeep(item);
      }
      return out as T;
    }
    return value;
  }
}

// A password field's own current value is never worth returning even redacted-to-mask —
// design §6: "Schaltet die Seite ein Passwortfeld auf type=text (\"Passwort anzeigen\"),
// bleibt es geschwärzt." The accessibility snapshot and the screenshot cover this
// differently (a value never read at all, an area drawn over); this only concerns text
// tools (console/network/errors) where the guard above is the actual mechanism. Kept here
// as the one shared list of what counts as a login-adjacent input, for the snapshot/
// screenshot code to reuse instead of guessing at selectors independently.
export function isCredentialField(input: {
  type?: string | null;
  autocomplete?: string | null;
  name?: string | null;
}): boolean {
  const type = (input.type ?? '').toLowerCase();
  const autocomplete = (input.autocomplete ?? '').toLowerCase();
  const name = (input.name ?? '').toLowerCase();
  if (type === 'password') return true;
  if (autocomplete.includes('current-password') || autocomplete.includes('new-password'))
    return true;
  if (autocomplete === 'one-time-code') return true;
  // "_"/"-" are word characters to \b, so "totp_code" needs them turned into a real
  // separator first or \btotp\b never finds a boundary before the underscore.
  return /\b(otp|totp|2fa|mfa|passcode)\b/.test(name.replace(/[-_]/g, ' '));
}
