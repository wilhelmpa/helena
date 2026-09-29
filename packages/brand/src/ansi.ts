// In a terminal the brand is its plain name, spaced like the wordmark: no block art.
export const TERMINAL_WORDMARK = 'A V A';

// The terminal wordmark, optionally in the Orb's violet (24-bit colour).
export function terminalWordmark(color = true): string {
  return color ? `\x1b[38;2;179;86;220m${TERMINAL_WORDMARK}\x1b[0m` : TERMINAL_WORDMARK;
}
