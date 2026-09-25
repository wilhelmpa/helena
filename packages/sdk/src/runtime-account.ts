// The login a runtime keeps of its own in an agent's home: a Codex agent's ChatGPT device
// login in its CODEX_HOME, a Claude Code login made in the agent's CLAUDE_CONFIG_DIR. It is
// not a credential Helena stores (those are runtime_login credentials in Zugänge): the
// runtime keeps and renews it itself, and nothing else may touch it (Codex rotates its
// refresh token on every use, so a second refresher would sign the agent out). Helena still
// shows it in Zugänge ("Anmeldungen"), as the runtime adapter reads it with the runtime's
// own interfaces: Codex' app-server (`account/read`), `claude auth status`. Only what those
// say about the account leaves the agent's unit: whether it is signed in, how, the account's
// e-mail address and plan, and when the runtime last wrote its login file (the file's time,
// never its content). Never a token.

// How the login signs in, as the runtime names it: `chatgpt` (Codex' device login),
// `api-key`, `claude.ai` (Claude Code's subscription login), `console`, or another word.
export interface RuntimeAccount {
  // Null where the runtime could not tell (not installed, did not answer).
  signedIn: boolean | null;
  method: string | null;
  email: string | null;
  // The plan the account is on (`pro`, `plus`, `max`), as the runtime names it.
  plan: string | null;
  // The organization or workspace, where the runtime names one.
  organization: string | null;
  // ISO 8601: when the runtime last wrote its login (signed in or renewed it).
  refreshedAt: string | null;
  // ISO 8601: when the adapter asked.
  checkedAt: string;
  // What the owner runs in the owner terminal to sign the runtime in (again).
  command: string | null;
}

const EMAIL = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}$/;
const WORD = /^[\p{L}\p{N}][\p{L}\p{N} ._+&()'_-]{0,79}$/u;
// A command is shown and copied, never run by Helena: one line of printable text.
const COMMAND = /^[\x20-\x7e]{1,600}$/;
// A value that could be a token: one long run without spaces of the characters tokens are
// made of. Such a value never leaves as a word, whatever field it came in.
const TOKEN_LIKE = /[A-Za-z0-9_\-.~+/=]{32,}/;

function word(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed || TOKEN_LIKE.test(trimmed) || !WORD.test(trimmed)) return null;
  return trimmed;
}

function email(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  // An address has words, a token one long run of its characters.
  return EMAIL.test(trimmed) && !/[A-Za-z0-9_-]{32,}/.test(trimmed) ? trimmed : null;
}

function isoDate(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const time = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

// What an adapter, a plugin or a runner reported, made safe to store and show: the known
// fields only, each checked, a token-like word dropped. Null when it is not an account.
export function normalizeRuntimeAccount(value: unknown): RuntimeAccount | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const checkedAt = isoDate(raw.checkedAt);
  if (!checkedAt) return null;
  const signedIn = typeof raw.signedIn === 'boolean' ? raw.signedIn : null;
  return {
    signedIn,
    method: word(raw.method),
    // A login that is gone names no account any more.
    email: signedIn === false ? null : email(raw.email),
    plan: signedIn === false ? null : word(raw.plan),
    organization: signedIn === false ? null : word(raw.organization),
    refreshedAt: signedIn === false ? null : isoDate(raw.refreshedAt),
    checkedAt,
    command: typeof raw.command === 'string' && COMMAND.test(raw.command) ? raw.command : null,
  };
}
