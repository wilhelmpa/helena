// browser_snapshot (design §4): an accessibility snapshot with stable refs. It is
// Playwright's own AI snapshot (`page.ariaSnapshot({ mode: 'ai' })`): the accessibility
// tree as YAML with `[ref=e5]` on every element an agent can act on, the text of the page,
// and the content of iframes (their refs carry the frame, `f1e3`). The refs live in the
// injected script's memory, in patchright's isolated world: nothing is written into the
// page's DOM, so a page cannot see a snapshot being taken (design §7). A ref is resolved
// again with the `aria-ref=<ref>` selector.
//
// What a password or 2FA field holds never reaches the agent: session.ts reads the current
// values of every credential-shaped field in every frame just before the snapshot and
// removes them from its text (redactValues), on top of the session's SecretGuard, which
// removes every secret the gateway itself typed wherever it shows up.
//
// This file holds the pure pieces, testable without a browser.

// A ref of the AI snapshot: `e12`, or `f3e12` for an element inside an iframe.
const REF_PATTERN = /^(?:f[0-9]+)?e[0-9]+$/;

export function isValidRef(ref: string): boolean {
  return REF_PATTERN.test(ref);
}

export function refSelector(ref: string): string {
  return `aria-ref=${ref}`;
}

// The snapshot of a large page can be long; an agent that needs more scrolls, or acts on
// what it sees. The limit keeps one call from filling a model's context.
export const MAX_SNAPSHOT_CHARS = 40_000;

export function truncateSnapshot(text: string, limit = MAX_SNAPSHOT_CHARS): string {
  if (text.length <= limit) return text;
  const cut = text.lastIndexOf('\n', limit);
  return `${text.slice(0, cut > 0 ? cut : limit)}\n… (snapshot cut at ${limit} characters; scroll or act on what is shown)`;
}

const VALUE_MASK = '[hidden]';

// Removes each value (a credential field's current content) from the text, longest first.
// Values shorter than three characters are left alone: they would mangle ordinary text and
// no password or code is that short.
export function redactValues(text: string, values: string[]): string {
  const ordered = [...new Set(values.filter((value) => value.length >= 3))].sort(
    (a, b) => b.length - a.length,
  );
  let out = text;
  for (const value of ordered) out = out.split(value).join(VALUE_MASK);
  return out;
}

// The CSS selector of the fields the gateway treats as credentials in every frame: password
// inputs, and inputs the page itself marks as a password or a one-time code.
export const CREDENTIAL_SELECTOR = [
  'input[type="password" i]',
  'input[autocomplete*="password" i]',
  'input[autocomplete="one-time-code" i]',
].join(', ');
