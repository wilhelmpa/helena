// browser_snapshot (design §4): an accessibility snapshot with stable refs, password/2FA
// fields shown redacted. Refs are plain data-attributes the gateway tags elements with
// in-page (via an isolated-world evaluate — confirmed safe against Runtime.enable/sourceURL
// leaks in the patchright spike) and resolves later with an ordinary CSS-attribute
// selector, rather than relying on any Playwright-internal ref-locator mechanism: the whole
// scheme is one page.evaluate() to tag, and page.locator('[data-volition-ref="e3"]') to
// resolve, both fully public, documented API surface.
//
// This file holds the pure, browser-independent pieces (the in-page tagging script as a
// string, and turning what it returns into the text the tool response carries) so they are
// unit-testable without a real browser; session.ts drives them against a real page.

export const REF_ATTR = 'data-volition-ref';

export interface RawSnapshotNode {
  ref: string;
  role: string;
  name: string;
  value: string | null;
  checked: boolean | null;
  disabled: boolean;
  credential: boolean; // isCredentialField(...) computed in-page, where the input's real attrs are
  depth: number;
}

// Evaluated once per browser_snapshot call. Walks every element interesting to an agent —
// visible, and either interactive or carrying meaningful text/role — tags it with a fresh
// data-volition-ref, and returns a flat, depth-ordered list the gateway turns into text.
// Kept as one field (rather than importing a shared helper) so the in-page copy of
// isCredentialField-equivalent logic is visibly next to what it protects.
export const TAG_SCRIPT = `(() => {
  const REF_ATTR = ${JSON.stringify(REF_ATTR)};
  for (const el of document.querySelectorAll('[' + REF_ATTR + ']')) el.removeAttribute(REF_ATTR);

  function isCredentialField(el) {
    const type = (el.getAttribute('type') || '').toLowerCase();
    const autocomplete = (el.getAttribute('autocomplete') || '').toLowerCase();
    const name = (el.getAttribute('name') || '').toLowerCase().replace(/[-_]/g, ' ');
    if (type === 'password') return true;
    if (autocomplete.includes('current-password') || autocomplete.includes('new-password')) return true;
    if (autocomplete === 'one-time-code') return true;
    return /\\b(otp|totp|2fa|mfa|passcode)\\b/.test(name);
  }

  function visible(el) {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  const INTERACTIVE = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY']);
  function roleOf(el) {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName;
    if (tag === 'A' && el.hasAttribute('href')) return 'link';
    if (tag === 'BUTTON') return 'button';
    if (tag === 'INPUT') return 'textbox:' + (el.getAttribute('type') || 'text');
    if (tag === 'SELECT') return 'combobox';
    if (tag === 'TEXTAREA') return 'textbox';
    if (/^H[1-6]$/.test(tag)) return 'heading';
    return 'generic';
  }

  function nameOf(el) {
    const label = el.getAttribute('aria-label');
    if (label) return label;
    const placeholder = el.getAttribute('placeholder');
    if (placeholder) return placeholder;
    const text = (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ');
    return text.slice(0, 120);
  }

  let counter = 0;
  const out = [];
  function walk(el, depth) {
    if (!(el instanceof Element) || !visible(el)) return;
    const interactive = INTERACTIVE.has(el.tagName) || el.hasAttribute('role') || el.hasAttribute('onclick');
    const heading = /^H[1-6]$/.test(el.tagName);
    if (interactive || heading) {
      const ref = 'e' + ++counter;
      el.setAttribute(REF_ATTR, ref);
      const credential = isCredentialField(el);
      out.push({
        ref,
        role: roleOf(el),
        name: credential ? '' : nameOf(el),
        value: credential ? null : ('value' in el ? String(el.value ?? '') : null),
        checked: 'checked' in el ? Boolean(el.checked) : null,
        disabled: Boolean(el.disabled),
        credential,
        depth,
      });
    }
    // Interactive leaves are not descended into further (a button's inner span is not its
    // own target); headings and generic containers are, so their interactive children
    // still get tagged.
    if (interactive && !heading) return;
    for (const child of el.children) walk(child, depth + 1);
  }
  walk(document.body, 0);
  return out;
})()`;

export function credentialValuePlaceholder(role: string): string {
  return role.startsWith('textbox:password')
    ? '[password — never shown]'
    : '[filled — never shown]';
}

// Turns the tagging script's result into the text a tool response carries — indented by
// depth, one line per node, credential fields shown as a placeholder rather than their
// value (design §6: "Werte von Passwortfeldern und gefüllten Login-Feldern geschwärzt").
export function renderSnapshot(nodes: RawSnapshotNode[]): string {
  if (nodes.length === 0) return '(no interactive elements found)';
  return nodes
    .map((node) => {
      const indent = '  '.repeat(node.depth);
      const bits = [`[${node.ref}] ${node.role}`];
      if (node.credential) {
        bits.push(credentialValuePlaceholder(node.role));
      } else {
        if (node.name) bits.push(JSON.stringify(node.name));
        if (node.value) bits.push(`value=${JSON.stringify(node.value)}`);
        if (node.checked !== null) bits.push(node.checked ? 'checked' : 'unchecked');
      }
      if (node.disabled) bits.push('disabled');
      return indent + bits.join(' ');
    })
    .join('\n');
}

export function refSelector(ref: string): string {
  return `[${REF_ATTR}="${ref}"]`;
}

// A safe ref looks like the tagging script's own output ("e12"); anything else could only
// be a caller guessing, which the design's "klare Meldung 'Snapshot neu holen'" is meant to
// catch as a stale/unknown ref rather than let through to a raw selector.
const REF_PATTERN = /^e[1-9][0-9]*$/;

export function isValidRef(ref: string): boolean {
  return REF_PATTERN.test(ref);
}
