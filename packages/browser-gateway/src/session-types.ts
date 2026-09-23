import type { SecretGuard } from './redact.ts';
import type { DomainPolicy } from './domain.ts';

// What server.ts needs from a browser session, independent of patchright — session.ts is
// the real, patchright-backed implementation; server.ts's own tests use a small fake
// implementing this same interface, so the dispatch logic (locking, resolving, auditing,
// redaction) is provable without a real Chromium.

export interface TabInfo {
  id: string;
  url: string;
  title: string;
  active: boolean;
}

export interface GatewaySession {
  // Tracks every secret this session has typed or computed, for redact-on-the-way-out on
  // every text response (design §6) — shared across every tool call against this session,
  // for as long as the underlying page/profile lives.
  guard: SecretGuard;

  // Design §8: blocks any request (navigation, click, redirect, sub-resource) whose host
  // the project's settings disallow. Called by the dispatcher before every page-touching
  // tool; a real implementation makes this a no-op when the policy has not changed.
  applyDomainPolicy(policy: DomainPolicy): Promise<void>;

  status(): Promise<{ url: string; tabCount: number; dialogOpen: boolean }>;
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
  // A data: URI is embedded directly in the text today (see server.ts) — a real MCP image
  // content block is a follow-up once the shim's wire protocol can add a content kind
  // without breaking the frozen text-only contract it ships with.
  screenshot(ref?: string): Promise<string>;
  tabs(action: 'list' | 'open' | 'focus' | 'close', url?: string, tabId?: string): Promise<string>;
  dialogAction(action: 'accept' | 'dismiss', promptText?: string): Promise<string>;
  upload(ref: string, absolutePath: string): Promise<string>;
  downloads(): Promise<string>;
  console(limit: number): Promise<string>;
  network(limit: number): Promise<string>;
  // The password (and username, filled the ordinary way) never appears in the return
  // value; the caller (server.ts) has already tracked it in `guard` before calling this.
  fillLogin(
    usernameRef: string,
    passwordRef: string,
    username: string,
    password: string,
  ): Promise<string>;
  fillCode(ref: string, code: string): Promise<string>;
}

export interface SessionProvider {
  get(slug: string): Promise<GatewaySession>;
}
