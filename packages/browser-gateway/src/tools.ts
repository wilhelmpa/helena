// The MCP tool surface (design §4). One list, shared by the gateway's own MCP server (the
// router process) and by whoever documents/tests it — the stdio shim never sees this: it
// only relays whatever the gateway answers to tools/list and tools/call.
//
// Deliberately absent (design §4, "Bewusst nicht vorhanden"): a free evaluate/JavaScript
// tool, reading or setting cookies, raw CDP access, chrome-devtools-mcp. Nothing below
// takes an arbitrary script or a raw CDP method name as input.
//
// Every tool takes an optional `project` (a project's key, or "home"), for the Home-Master
// only — checked by the gateway (only the Home socket accepts it) and again by Helena
// against the caller, never trusted from the input alone.

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
      "Home-Master only: the key of the project whose browser to use (e.g. \"VOL\"), or " +
      '"home" for Home\'s own browser. Leave it out otherwise — every other agent always ' +
      'works in its own project\'s browser.',
  },
};

// The way of working every tool description relies on, also sent as the MCP server's
// instructions (browser-gateway-mcp-shim.mjs).
export const BROWSER_INSTRUCTIONS = [
  "This is the project's own, always-on browser, shared with the owner and other agents; its sign-ins persist.",
  'Work like this: browser_acquire, then browser_snapshot to see the page with refs, act on refs (browser_click, browser_type, …), take a new snapshot after the page changed, and browser_release when done.',
  'Never type a password or 2FA code yourself and never ask for one: browser_login fills a login granted to you in Zugänge for the page it is on, browser_login_code the current code.',
  'A CAPTCHA, a question only the owner can answer, or anything you are unsure about: browser_handover and wait.',
  'Files: browser_upload sends a file of your workspace or project folder; downloads land in the project\'s Inbox (browser_downloads lists them).',
].join(' ');

const ref = {
  ref: { type: 'string', description: 'A stable ref from the most recent browser_snapshot.' },
};

export const BROWSER_TOOLS: ToolDef[] = [
  {
    name: 'browser_status',
    title: 'Browser status',
    description:
      'Who controls the project browser (you, another agent, the owner, or nobody), the ' +
      'active tab, the number of tabs, and whether a dialog is open.',
    inputSchema: { type: 'object', properties: { ...project }, additionalProperties: false },
  },
  {
    name: 'browser_acquire',
    title: 'Take control',
    description:
      'Take control of the project browser before acting on it, waiting up to timeoutSec ' +
      'if someone else holds it; reports who is blocking if it gives up. Control lapses ' +
      'after a while without any action (the project setting, 2 minutes by default).',
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
    description:
      'Give control of the project browser back when you are done. Tabs you opened ' +
      'are closed.',
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
      'The active tab as an accessibility tree: its text, and a [ref=…] on every element ' +
      'the other tools act on (iframes included). Take a new one after the page changed; ' +
      'refs of an old snapshot go stale. What a password or code field holds is never shown.',
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
      'A picture of the viewport or of one element by ref, for what a snapshot cannot ' +
      'say (layout, images, a chart). Login fields are covered in the picture.',
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
      'Upload a file to a file input by ref. `path` is a file you can read yourself (your ' +
      'workspace or your project folder); it is read on your side and sent, at most 50 MB.',
    inputSchema: {
      type: 'object',
      properties: {
        ...project,
        ...ref,
        path: { type: 'string', description: 'Absolute, or relative to your working directory.' },
      },
      required: ['ref', 'path'],
      additionalProperties: false,
    },
  },
  {
    name: 'browser_downloads',
    title: 'Downloads',
    description:
      "The files this browser downloaded, and where each was kept (the project's Inbox " +
      'folder, which you can read).',
    inputSchema: { type: 'object', properties: { ...project }, additionalProperties: false },
  },
  {
    name: 'browser_console',
    title: 'Console',
    description:
      'Recent browser log entries of the tabs, newest last: failed requests, blocked ' +
      "content, security warnings. The page's own console.log is not available (reading it " +
      'would show the page an automated browser).',
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
      'Recent network responses of the tabs: method, status, URL (values of token-like ' +
      'query parameters hidden). No headers, no bodies.',
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
      'Fill a login granted to you in Zugänge into a login form: the username field and ' +
      'the password field by ref. The login is chosen for the site of the frame the ' +
      'password field is in; if several match, the answer lists them (label and username) ' +
      'and you call again with credentialId. You never see the password.',
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
      'Type the current 2FA code of a login (credentialId, as browser_login named it) into ' +
      'the code field by ref. Only on a page of that login\'s site.',
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
      'Ask the owner to take over (a CAPTCHA, a question only they can answer). Shows a ' +
      'card in the live view and in Helena, and waits up to timeoutSec until the owner ' +
      'has taken over and given control back.',
    inputSchema: {
      type: 'object',
      properties: {
        ...project,
        reason: { type: 'string', description: 'What the owner should do, in one sentence.' },
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
