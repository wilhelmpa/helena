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

export interface ClickOptions {
  button?: 'left' | 'right' | 'middle';
  doubleClick?: boolean;
  modifiers?: ('Alt' | 'Control' | 'ControlOrMeta' | 'Meta' | 'Shift')[];
}

// One field of browser_fill_form (Playwright MCP's shape).
export interface FormField {
  target: string;
  name: string;
  type: 'textbox' | 'checkbox' | 'radio' | 'combobox' | 'slider';
  value: string;
}

export type ConsoleLevel = 'error' | 'warning' | 'info' | 'debug';

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
  // Every page tool answers the way Playwright MCP does: a "### Result" line, then the page
  // after the action ("### Page", "### Open tabs", "### Modal state", "### Events").
  navigate(url: string): Promise<string>;
  back(): Promise<string>;
  reload(): Promise<string>;
  snapshot(options?: { target?: string; depth?: number }): Promise<string>;
  find(text: string): Promise<string>;
  click(target: string, options?: ClickOptions): Promise<string>;
  type(target: string, text: string, submit?: boolean): Promise<string>;
  fillForm(fields: FormField[]): Promise<string>;
  select(target: string, values: string[]): Promise<string>;
  hover(target: string): Promise<string>;
  drag(startTarget: string, endTarget: string): Promise<string>;
  press(key: string): Promise<string>;
  scroll(
    direction: 'up' | 'down' | 'left' | 'right',
    amount: number,
    target?: string,
  ): Promise<string>;
  waitFor(options: { time?: number; text?: string; textGone?: string }): Promise<string>;
  screenshot(options?: { target?: string; fullPage?: boolean }): Promise<ToolOutput>;
  // `agentId` names who opens a tab: a tab an agent opens is closed again when it gives
  // control back (closeTabsOf).
  tabs(
    action: 'list' | 'new' | 'close' | 'select',
    options?: { url?: string; index?: number; agentId?: number },
  ): Promise<string>;
  closeTabsOf(agentId: number): Promise<void>;
  dialogAction(accept: boolean, promptText?: string): Promise<string>;
  // Into the open file chooser, or into `target` (a file input, or a button that opens the
  // chooser). No files cancels the open chooser.
  upload(files: UploadFile[], target?: string): Promise<string>;
  downloads(): Promise<string>;
  console(level: ConsoleLevel): Promise<string>;
  network(options: { includeStatic: boolean; filter?: string }): Promise<string>;
  // Whether the call would submit a form: a click on a form's submit control, Enter typed
  // into a form field (browser_type with submit, browser_press_key Enter). Such a call is decided
  // as 'send' rather than 'write' (agent-tool.ts); `formAction` names where the form goes.
  submitsForm(call: {
    tool: string;
    target?: string;
    key?: string;
    submit?: boolean;
  }): Promise<{ submits: boolean; formAction: string | null }>;
  // The origin of the tab in front, for the policy's context.
  pageOrigin(): string | null;
  // The origin of the frame the element is in (design §6: a login is offered for the
  // frame's origin, not the tab's).
  frameOrigin(target: string): Promise<string>;
  // Types a login into its two fields. Refused unless the password field is one (a
  // password could otherwise be typed into a visible text field and photographed), and
  // unless both fields are still in `origin` right before typing. The caller has already
  // tracked the password in `guard`.
  fillLogin(
    usernameTarget: string,
    passwordTarget: string,
    username: string,
    password: string,
    origin: string,
  ): Promise<string>;
  fillCode(target: string, code: string): Promise<string>;
}

export interface SessionProvider {
  get(slug: string): Promise<GatewaySession>;
}
