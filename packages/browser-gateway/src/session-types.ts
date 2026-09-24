import type { SecretGuard } from './redact.ts';
import type { DomainPolicy } from './domain.ts';

// What server.ts needs from a browser session, independent of patchright — session.ts is
// the real, patchright-backed implementation; server.ts's own tests use a small fake
// implementing this same interface, so the dispatch logic (locking, resolving, auditing,
// redaction) is provable without a real Chromium.

// What a tool hands back: text for the model, and for a screenshot the picture itself
// (an MCP image block — never base64 inside the text, which would cost the model a
// fortune in tokens for nothing).
export interface ToolOutput {
  text: string;
  image?: { data: string; mimeType: string };
}

// A file an agent uploads. The shim reads it inside the agent's own sandbox, with exactly
// the agent's rights, and sends its bytes; the gateway never opens a path an agent names
// (it runs as the browser user, which can read every project's browser profile).
export interface UploadFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

export interface BrowserStatus {
  url: string;
  title: string;
  tabCount: number;
  dialogOpen: boolean;
}

export interface GatewaySession {
  // Tracks every secret this session has typed or computed, for redact-on-the-way-out on
  // every text response (design §6) — shared across every tool call against this session,
  // for as long as the underlying page/profile lives.
  guard: SecretGuard;

  // False once the browser's DevTools connection is gone (the browser restarted); the
  // provider then connects again instead of handing out a dead session.
  isConnected(): boolean;

  // The project's "menschliche Eingabe" setting, re-applied before every call.
  setHumanInput(value: boolean): void;

  // Design §8: blocks any request (navigation, click, redirect, sub-resource, a tab the
  // page opens) whose host the project's settings disallow. Called before every
  // page-touching tool; a no-op when the policy has not changed.
  applyDomainPolicy(policy: DomainPolicy): Promise<void>;

  status(): Promise<BrowserStatus>;
  navigate(url: string): Promise<string>;
  back(): Promise<string>;
  reload(): Promise<string>;
  snapshot(): Promise<string>;
  click(ref: string, button?: 'left' | 'right' | 'middle'): Promise<string>;
  type(ref: string, text: string, submit?: boolean): Promise<string>;
  select(ref: string, values: string[]): Promise<string>;
  hover(ref: string): Promise<string>;
  drag(fromRef: string, toRef: string): Promise<string>;
  press(key: string): Promise<string>;
  scroll(
    direction: 'up' | 'down' | 'left' | 'right',
    amount: number,
    ref?: string,
  ): Promise<string>;
  screenshot(ref?: string): Promise<ToolOutput>;
  // `agentId` names who opens a tab: a tab an agent opens is closed again when it gives
  // control back (closeTabsOf).
  tabs(
    action: 'list' | 'open' | 'focus' | 'close',
    options?: { url?: string; tabId?: string; agentId?: number },
  ): Promise<string>;
  closeTabsOf(agentId: number): Promise<void>;
  dialogAction(action: 'accept' | 'dismiss', promptText?: string): Promise<string>;
  upload(ref: string, file: UploadFile): Promise<string>;
  downloads(): Promise<string>;
  console(limit: number): Promise<string>;
  network(limit: number): Promise<string>;
  // The origin of the frame the element is in (design §6: a login is offered for the
  // frame's origin, not the tab's).
  frameOrigin(ref: string): Promise<string>;
  // Types a login into its two fields. Refused unless the password field is one (a
  // password could otherwise be typed into a visible text field and photographed), and
  // unless both fields are still in `origin` right before typing. The caller has already
  // tracked the password in `guard`.
  fillLogin(
    usernameRef: string,
    passwordRef: string,
    username: string,
    password: string,
    origin: string,
  ): Promise<string>;
  fillCode(ref: string, code: string): Promise<string>;
}

export interface SessionProvider {
  get(slug: string): Promise<GatewaySession>;
}
