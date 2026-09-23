// The MCP tool surface (design §4). One list, shared by the gateway's own MCP server (the
// router process) and by whoever documents/tests it — the stdio shim never sees this: it
// only relays whatever the gateway answers to tools/list and tools/call.
//
// Deliberately absent (design §4, "Bewusst nicht vorhanden"): a free evaluate/JavaScript
// tool, reading or setting cookies, raw CDP access, chrome-devtools-mcp. Nothing below
// takes an arbitrary script or a raw CDP method name as input.
//
// Every tool but browser_status/browser_acquire takes an optional `project` (a project's
// key), for the Home-Master only — checked server-side against the caller's grants, never
// trusted from the input alone (see the gateway server's resolve() call per request).

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const project = {
  project: {
    type: 'string',
    description:
      "A project's key. Only the Home-Master may set this — checked against the caller's " +
      "grants on every call. Every other agent's calls always act on its own project.",
  },
};

const ref = {
  ref: { type: 'string', description: 'A stable ref from the most recent browser_snapshot.' },
};

export const BROWSER_TOOLS: ToolDef[] = [
  {
    name: 'browser_status',
    title: 'Browser status',
    description:
      'Who controls the project browser, its open tabs, the current URL, and whether a ' +
      'dialog is open.',
    inputSchema: { type: 'object', properties: { ...project }, additionalProperties: false },
  },
  {
    name: 'browser_acquire',
    title: 'Take control',
    description:
      'Take control of the project browser, waiting up to timeoutSec if someone else holds ' +
      'it. Reports who is blocking if it gives up.',
    inputSchema: {
      type: 'object',
      properties: {
        ...project,
        timeoutSec: { type: 'number', minimum: 0, maximum: 600, default: 30 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'browser_release',
    title: 'Give control back',
    description: 'Give control of the project browser back.',
    inputSchema: { type: 'object', properties: { ...project }, additionalProperties: false },
  },
  {
    name: 'browser_navigate',
    title: 'Navigate',
    description:
      'Go to a URL, waiting for the page to load and the network to settle. Refused for a ' +
      "domain the project's settings block.",
    inputSchema: {
      type: 'object',
      properties: { ...project, url: { type: 'string' } },
      required: ['url'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_back',
    title: 'Go back',
    description: 'Go back one page, waiting for it to load.',
    inputSchema: { type: 'object', properties: { ...project }, additionalProperties: false },
  },
  {
    name: 'browser_reload',
    title: 'Reload',
    description: 'Reload the current page, waiting for it to load.',
    inputSchema: { type: 'object', properties: { ...project }, additionalProperties: false },
  },
  {
    name: 'browser_snapshot',
    title: 'Accessibility snapshot',
    description:
      'An accessibility snapshot of the page with stable refs for the click/type/... tools ' +
      'below. Password fields and any field currently holding a filled login are shown ' +
      'redacted, never their value.',
    inputSchema: { type: 'object', properties: { ...project }, additionalProperties: false },
  },
  {
    name: 'browser_click',
    title: 'Click',
    description: 'Click an element by ref, with human-like pointer movement and timing.',
    inputSchema: {
      type: 'object',
      properties: {
        ...project,
        ...ref,
        button: { type: 'string', enum: ['left', 'right', 'middle'] },
      },
      required: ['ref'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_type',
    title: 'Type',
    description:
      'Type text into an element by ref, with human-like key timing. Refused on a password ' +
      'or 2FA field — use browser_login / browser_login_code instead, so the value never ' +
      'passes through a prompt.',
    inputSchema: {
      type: 'object',
      properties: { ...project, ...ref, text: { type: 'string' }, submit: { type: 'boolean' } },
      required: ['ref', 'text'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_select',
    title: 'Select',
    description: 'Choose one or more options of a <select> by ref.',
    inputSchema: {
      type: 'object',
      properties: { ...project, ...ref, values: { type: 'array', items: { type: 'string' } } },
      required: ['ref', 'values'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_hover',
    title: 'Hover',
    description: 'Move the pointer over an element by ref, human-like.',
    inputSchema: {
      type: 'object',
      properties: { ...project, ...ref },
      required: ['ref'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_drag',
    title: 'Drag',
    description: 'Drag from one element (by ref) to another.',
    inputSchema: {
      type: 'object',
      properties: {
        ...project,
        fromRef: { type: 'string' },
        toRef: { type: 'string' },
      },
      required: ['fromRef', 'toRef'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_press',
    title: 'Press a key',
    description: 'Press a key or key combination (e.g. "Enter", "Control+A").',
    inputSchema: {
      type: 'object',
      properties: { ...project, key: { type: 'string' } },
      required: ['key'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_scroll',
    title: 'Scroll',
    description: 'Scroll the page or an element by ref, in steps rather than a single jump.',
    inputSchema: {
      type: 'object',
      properties: {
        ...project,
        ref: { type: 'string', description: 'Omit to scroll the page itself.' },
        direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
        amount: { type: 'number', minimum: 1, maximum: 10, default: 3 },
      },
      required: ['direction'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_screenshot',
    title: 'Screenshot',
    description:
      'A screenshot of the viewport or one element by ref. A filled login field is covered ' +
      'before the picture is taken.',
    inputSchema: {
      type: 'object',
      properties: {
        ...project,
        ref: { type: 'string', description: 'Omit for the whole viewport.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'browser_tabs',
    title: 'Tabs',
    description:
      'List, open, focus or close tabs. A tab an agent opens belongs to it and closes when ' +
      'its session ends.',
    inputSchema: {
      type: 'object',
      properties: {
        ...project,
        action: { type: 'string', enum: ['list', 'open', 'focus', 'close'] },
        url: { type: 'string', description: 'For action "open".' },
        tabId: { type: 'string', description: 'For action "focus"/"close".' },
      },
      required: ['action'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_dialog',
    title: 'Handle a dialog',
    description: "Accept or dismiss the page's current JavaScript dialog (alert/confirm/prompt).",
    inputSchema: {
      type: 'object',
      properties: {
        ...project,
        action: { type: 'string', enum: ['accept', 'dismiss'] },
        promptText: { type: 'string' },
      },
      required: ['action'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_upload',
    title: 'Upload a file',
    description:
      "Upload a file from the project's workspace or vault to a file input by ref. The path " +
      'is resolved server-side inside the project — it cannot reach outside it.',
    inputSchema: {
      type: 'object',
      properties: { ...project, ...ref, path: { type: 'string' } },
      required: ['ref', 'path'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_downloads',
    title: 'Downloads',
    description: "List the files the page has downloaded, saved under the project's vault Inbox.",
    inputSchema: { type: 'object', properties: { ...project }, additionalProperties: false },
  },
  {
    name: 'browser_console',
    title: 'Console',
    description:
      'Recent console messages, filtered: no cookie or authorization header ever appears ' +
      'here because none of these tools read them in the first place.',
    inputSchema: {
      type: 'object',
      properties: { ...project, limit: { type: 'number', minimum: 1, maximum: 200, default: 50 } },
      additionalProperties: false,
    },
  },
  {
    name: 'browser_network',
    title: 'Network',
    description:
      'Recent network requests: method, URL, status, timing. No request or response body, ' +
      'no cookie or authorization header.',
    inputSchema: {
      type: 'object',
      properties: { ...project, limit: { type: 'number', minimum: 1, maximum: 200, default: 50 } },
      additionalProperties: false,
    },
  },
  {
    name: 'browser_login',
    title: 'Fill a login',
    description:
      "Fill a granted login's username and password for the origin of the frame the login " +
      'field is in. Omit credentialId to match by origin; if more than one login matches, ' +
      'the result lists them by label and username (never a password) so the tool can be ' +
      'called again with the chosen credentialId. The password is typed as input events, ' +
      'never set as a DOM value, and is never returned to the caller.',
    inputSchema: {
      type: 'object',
      properties: {
        ...project,
        usernameRef: { type: 'string' },
        passwordRef: { type: 'string' },
        credentialId: { type: 'number' },
      },
      required: ['usernameRef', 'passwordRef'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_login_code',
    title: 'Fill the current 2FA code',
    description:
      "Compute and type the login's current TOTP code into a field by ref. The " +
      'authenticator key never leaves Plan; only the current code does.',
    inputSchema: {
      type: 'object',
      properties: { ...project, ...ref, credentialId: { type: 'number' } },
      required: ['ref', 'credentialId'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_handover',
    title: 'Ask the owner to take over',
    description:
      'Raises a handover card for the owner (e.g. a CAPTCHA) with a link to the live view, ' +
      'and waits up to timeoutSec for them to finish and give control back.',
    inputSchema: {
      type: 'object',
      properties: {
        ...project,
        reason: { type: 'string' },
        timeoutSec: { type: 'number', minimum: 30, maximum: 1800, default: 300 },
      },
      required: ['reason'],
      additionalProperties: false,
    },
  },
];

// Tools that need the lock held before they act (everything that touches the page or a
// tab); browser_status/browser_acquire/browser_release manage the lock itself and are
// exempt. browser_handover is exempt too — it works precisely when the caller cannot act.
const LOCK_EXEMPT = new Set([
  'browser_status',
  'browser_acquire',
  'browser_release',
  'browser_handover',
]);

export function requiresLock(toolName: string): boolean {
  return !LOCK_EXEMPT.has(toolName);
}

// Tools whose target field the gateway fills itself from Zugänge — never accept a literal
// value for these from the caller (browser_type already refuses a credential-looking ref,
// see redact.ts's isCredentialField, but this is the tool-name-level version other code
// checks first, before it even inspects the target field).
export const CREDENTIAL_TOOLS = new Set(['browser_login', 'browser_login_code']);

export function toolByName(name: string): ToolDef | undefined {
  return BROWSER_TOOLS.find((tool) => tool.name === name);
}
