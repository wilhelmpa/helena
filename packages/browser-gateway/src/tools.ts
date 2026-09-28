// The MCP tool surface (design §4; docs/helena-decisions/browser-tools.md): Playwright MCP's
// names, parameters and descriptions for every tool the standard has, plus Helena's own
// tools for the lock, the owner, Zugänge and downloads. The shim lists these (shim.ts); the
// gateway (server.ts) runs them.
//
// Deliberately absent (design §4, "Bewusst nicht vorhanden", and the decision record): a free
// evaluate/JavaScript tool, run_code, cookies/storage/routes, full request headers and
// bodies, closing or resizing the browser, raw CDP access. Nothing below takes an arbitrary
// script or a raw CDP method name as input.
//
// Every tool takes an optional `project` (a project's key, or "home"), for the Home-Master
// only — checked by the gateway (only the Home socket accepts it) and again by Helena
// against the caller, never trusted from the input alone.

import type { ActionCategory, AgentToolDefinition } from './agent-tool.ts';

export type ToolDef = AgentToolDefinition;

const project = {
  project: {
    type: 'string',
    description:
      'Home-Master only: the key of the project whose browser to use (e.g. "VOL"), or ' +
      '"home" for Home\'s own browser. Leave it out otherwise — every other agent always ' +
      "works in its own project's browser.",
  },
};

// The way of working every tool description relies on, also sent as the MCP server's
// instructions (shim.ts).
export const BROWSER_INSTRUCTIONS = [
  "This is the project's own, always-on browser, shared with the owner and other agents; its sign-ins persist.",
  'The tools follow Playwright MCP: browser_snapshot shows the page with refs, the other tools act on a ref as `target`. Take a new snapshot after the page changed.',
  'Your first action takes control of the browser if it is free; browser_acquire waits while someone else works in it. Call browser_release when you are done.',
  'Never type a password or 2FA code yourself and never ask for one: browser_login fills a login granted to you in Zugänge for the page it is on, browser_login_code the current code.',
  'A CAPTCHA, a question only the owner can answer, or anything you are unsure about: browser_handover and wait.',
  'Where the project has a decision model (browser_task is listed), hand multi-step navigation and form flows with known values to browser_task in one call, check outcomes with browser_check, and continue with the step tools when it hands back.',
  "Files: browser_file_upload sends files of your workspace or project folder; downloads land in the project's Inbox (browser_downloads lists them).",
].join(' ');

// The parameter texts of Playwright MCP (patchright-core's tools/backend), so the tools read
// the way agents know them; playwright-parity.test.ts keeps names and shapes in step.
const TARGET =
  'Exact target element reference from the page snapshot (e.g. "e5" or "f1e5"). Refs only, no selectors.';
const ELEMENT =
  'Human-readable element description used to obtain permission to interact with the element';

const element = { element: { type: 'string', description: ELEMENT } };
const target = { target: { type: 'string', description: TARGET } };

function schema(properties: Record<string, unknown>, required: string[] = []) {
  return {
    type: 'object',
    properties: { ...project, ...properties },
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  };
}

const DEFINED_TOOLS: ToolDef[] = [
  {
    name: 'browser_navigate',
    category: 'write',
    title: 'Navigate to a URL',
    description:
      'Navigate to a URL, waiting for the page to load. Refused for a domain the ' +
      "project's settings block.",
    inputSchema: schema({ url: { type: 'string', description: 'The URL to navigate to' } }, [
      'url',
    ]),
  },
  {
    name: 'browser_navigate_back',
    category: 'write',
    title: 'Go back',
    description: 'Go back to the previous page in the history',
    inputSchema: schema({}),
  },
  {
    name: 'browser_reload',
    category: 'write',
    title: 'Reload the page',
    description: 'Reload the current page',
    inputSchema: schema({}),
  },
  {
    name: 'browser_snapshot',
    category: 'read',
    title: 'Page snapshot',
    description:
      'Capture accessibility snapshot of the current page, this is better than screenshot. ' +
      'Every element the other tools act on has a [ref=…] (iframes included); refs of an ' +
      'older snapshot go stale. What a password or code field holds is never shown.',
    inputSchema: schema({
      target: {
        type: 'string',
        description: 'Only the part of the page below this element ref',
      },
      depth: { type: 'number', description: 'Limit the depth of the snapshot tree' },
    }),
  },
  {
    name: 'browser_find',
    category: 'read',
    title: 'Find in page snapshot',
    description:
      'Search the accessibility snapshot of the current page for text (case-insensitive). ' +
      'Returns matching snapshot nodes with a few lines of surrounding context, including ' +
      'their refs: for a long page whose snapshot is cut off.',
    inputSchema: schema(
      {
        text: {
          type: 'string',
          description: 'Plain text to search for in the page snapshot (case-insensitive)',
        },
      },
      ['text'],
    ),
  },
  {
    name: 'browser_click',
    category: 'write',
    title: 'Click',
    description:
      'Perform click on a web page, with human-like pointer movement and timing. A click ' +
      'that submits a form counts as sending it.',
    inputSchema: schema(
      {
        ...element,
        ...target,
        doubleClick: {
          type: 'boolean',
          description: 'Whether to perform a double click instead of a single click',
        },
        button: {
          type: 'string',
          enum: ['left', 'right', 'middle'],
          description: 'Button to click, defaults to left',
        },
        modifiers: {
          type: 'array',
          items: { type: 'string', enum: ['Alt', 'Control', 'ControlOrMeta', 'Meta', 'Shift'] },
          description: 'Modifier keys to press',
        },
      },
      ['target'],
    ),
  },
  {
    name: 'browser_type',
    category: 'write',
    title: 'Type text',
    description:
      'Type text into editable element, replacing what it holds, with human-like key timing. ' +
      'Refused on a password or 2FA field: use browser_login / browser_login_code, so the ' +
      'value never passes through a prompt.',
    inputSchema: schema(
      {
        ...element,
        ...target,
        text: { type: 'string', description: 'Text to type into the element' },
        submit: {
          type: 'boolean',
          description: 'Whether to submit entered text (press Enter after)',
        },
        slowly: {
          type: 'boolean',
          description:
            'Whether to type one character at a time. Keys are always typed one by one here.',
        },
      },
      ['target', 'text'],
    ),
  },
  {
    name: 'browser_fill_form',
    category: 'write',
    title: 'Fill form',
    description:
      'Fill multiple form fields. Refused for a password or 2FA field (browser_login / ' +
      'browser_login_code).',
    inputSchema: schema(
      {
        fields: {
          type: 'array',
          description: 'Fields to fill in',
          items: {
            type: 'object',
            properties: {
              ...element,
              ...target,
              name: { type: 'string', description: 'Human-readable field name' },
              type: {
                type: 'string',
                enum: ['textbox', 'checkbox', 'radio', 'combobox', 'slider'],
                description: 'Type of the field',
              },
              value: {
                type: 'string',
                description:
                  'Value to fill in the field. If the field is a checkbox, the value should be ' +
                  '`true` or `false`. If the field is a combobox, the value should be the text ' +
                  'of the option.',
              },
            },
            required: ['target', 'name', 'type', 'value'],
            additionalProperties: false,
          },
        },
      },
      ['fields'],
    ),
  },
  {
    name: 'browser_select_option',
    category: 'write',
    title: 'Select option',
    description: 'Select an option in a dropdown',
    inputSchema: schema(
      {
        ...element,
        ...target,
        values: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Array of values to select in the dropdown. This can be a single value or multiple values.',
        },
      },
      ['target', 'values'],
    ),
  },
  {
    name: 'browser_hover',
    category: 'read',
    title: 'Hover mouse',
    description: 'Hover over element on page, human-like',
    inputSchema: schema({ ...element, ...target }, ['target']),
  },
  {
    name: 'browser_drag',
    category: 'write',
    title: 'Drag mouse',
    description: 'Perform drag and drop between two elements',
    inputSchema: schema(
      {
        startElement: {
          type: 'string',
          description:
            'Human-readable source element description used to obtain the permission to interact with the element',
        },
        startTarget: { type: 'string', description: TARGET },
        endElement: {
          type: 'string',
          description:
            'Human-readable target element description used to obtain the permission to interact with the element',
        },
        endTarget: { type: 'string', description: TARGET },
      },
      ['startTarget', 'endTarget'],
    ),
  },
  {
    name: 'browser_press_key',
    category: 'write',
    title: 'Press a key',
    description: 'Press a key on the keyboard. Enter in a form field counts as sending the form.',
    inputSchema: schema(
      {
        key: {
          type: 'string',
          description:
            'Name of the key to press or a character to generate, such as `ArrowLeft` or `a`',
        },
      },
      ['key'],
    ),
  },
  {
    name: 'browser_scroll',
    category: 'read',
    title: 'Scroll',
    description:
      'Scroll the page, or the element with this ref, with mouse wheel turns in steps ' +
      '(for content that loads while scrolling; clicks scroll by themselves).',
    inputSchema: schema(
      {
        ...element,
        target: { type: 'string', description: 'Omit to scroll the page itself.' },
        direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
        amount: { type: 'number', minimum: 1, maximum: 10, default: 3 },
      },
      ['direction'],
    ),
  },
  {
    name: 'browser_wait_for',
    category: 'read',
    title: 'Wait for',
    description:
      'Wait for text to appear or disappear or a specified time to pass (at most 30 seconds)',
    inputSchema: schema({
      time: { type: 'number', description: 'The time to wait in seconds' },
      text: { type: 'string', description: 'The text to wait for' },
      textGone: { type: 'string', description: 'The text to wait for to disappear' },
    }),
  },
  {
    name: 'browser_take_screenshot',
    category: 'read',
    title: 'Take a screenshot',
    description:
      "Take a screenshot of the current page. You can't perform actions based on the " +
      'screenshot, use browser_snapshot for actions. Always PNG; login fields are covered.',
    inputSchema: schema({
      ...element,
      target: {
        type: 'string',
        description: 'Element ref to screenshot; omit for the viewport.',
      },
      fullPage: {
        type: 'boolean',
        description:
          'When true, takes a screenshot of the full scrollable page, instead of the currently visible viewport. Cannot be used with element screenshots.',
      },
    }),
  },
  {
    name: 'browser_tabs',
    category: 'write',
    title: 'Manage tabs',
    description:
      'List, create, close, or select a browser tab. A tab you create closes again when you ' +
      'give control back.',
    inputSchema: schema(
      {
        action: {
          type: 'string',
          enum: ['list', 'new', 'close', 'select'],
          description: 'Operation to perform',
        },
        index: {
          type: 'number',
          description:
            'Tab index, used for close/select. If omitted for close, current tab is closed.',
        },
        url: { type: 'string', description: 'URL to navigate to in the new tab, used for new.' },
      },
      ['action'],
    ),
  },
  {
    name: 'browser_handle_dialog',
    category: 'write',
    title: 'Handle a dialog',
    description: 'Handle a dialog (alert, confirm, prompt, leaving a page)',
    inputSchema: schema(
      {
        accept: { type: 'boolean', description: 'Whether to accept the dialog.' },
        promptText: {
          type: 'string',
          description: 'The text of the prompt in case of a prompt dialog.',
        },
      },
      ['accept'],
    ),
  },
  {
    name: 'browser_file_upload',
    category: 'send',
    title: 'Upload files',
    description:
      'Upload one or multiple files into the open file chooser (click the upload button ' +
      'first), or into the file input or upload button given as target. The files are read ' +
      'on your side, with your rights (your workspace or project folder), 50 MB at most.',
    inputSchema: schema({
      ...element,
      target: {
        type: 'string',
        description: 'Optional: the file input, or the button that opens the file chooser.',
      },
      paths: {
        type: 'array',
        items: { type: 'string' },
        description:
          'The absolute paths to the files to upload. Can be single file or multiple files. If omitted, file chooser is cancelled.',
      },
    }),
  },
  {
    name: 'browser_downloads',
    category: 'read',
    title: 'Downloads',
    description:
      "The files this browser downloaded, and where each was kept (the project's Inbox " +
      'folder, which you can read).',
    inputSchema: schema({}),
  },
  {
    name: 'browser_console_messages',
    category: 'read',
    title: 'Get console messages',
    description:
      'Returns the browser log of the tabs: failed requests, blocked content, security ' +
      "warnings. The page's own console.log is not available (reading it would show the " +
      'page an automated browser).',
    inputSchema: schema({
      level: {
        type: 'string',
        enum: ['error', 'warning', 'info', 'debug'],
        default: 'info',
        description:
          'Level of the console messages to return. Each level includes the messages of more severe levels. Defaults to "info".',
      },
    }),
  },
  {
    name: 'browser_network_requests',
    category: 'read',
    title: 'List network requests',
    description:
      'Returns the recent network requests of the tabs: method, URL (values of token-like ' +
      'query parameters hidden) and status. No headers, no bodies.',
    inputSchema: schema({
      static: {
        type: 'boolean',
        default: false,
        description:
          'Whether to include successful static resources like images, fonts, scripts, etc. Defaults to false.',
      },
      filter: {
        type: 'string',
        description: 'Only return requests whose URL contains this text (case-insensitive).',
      },
    }),
  },
  {
    name: 'browser_login',
    category: 'write',
    title: 'Fill a login',
    description:
      'Fill a login granted to you in Zugänge into a login form: the username field and ' +
      'the password field by ref. The login is chosen for the site of the frame the ' +
      'password field is in; if several match, the answer lists them (label and username) ' +
      'and you call again with credentialId. You never see the password.',
    inputSchema: schema(
      {
        usernameTarget: { type: 'string', description: 'Ref of the username or e-mail field' },
        passwordTarget: { type: 'string', description: 'Ref of the password field' },
        credentialId: { type: 'number' },
      },
      ['usernameTarget', 'passwordTarget'],
    ),
  },
  {
    name: 'browser_login_code',
    category: 'write',
    title: 'Fill the current 2FA code',
    description:
      'Type the current 2FA code of a login (credentialId, as browser_login named it) into ' +
      "the code field by ref. Only on a page of that login's site.",
    inputSchema: schema({ ...target, credentialId: { type: 'number' } }, [
      'target',
      'credentialId',
    ]),
  },
  {
    name: 'browser_status',
    category: 'read',
    title: 'Browser status',
    description:
      'Who controls the project browser (you, another agent, the owner, or nobody), the ' +
      'active tab, the number of tabs, and whether a dialog is open.',
    inputSchema: schema({}),
  },
  {
    name: 'browser_acquire',
    category: 'read',
    title: 'Take control',
    description:
      'Take control of the project browser, waiting up to timeoutSec while someone else ' +
      'holds it; reports who is blocking if it gives up. (Any page action takes control by ' +
      'itself when the browser is free.) Control lapses after a while without any action ' +
      '(the project setting, 2 minutes by default).',
    inputSchema: schema({ timeoutSec: { type: 'number', minimum: 0, maximum: 600, default: 30 } }),
  },
  {
    name: 'browser_release',
    category: 'read',
    title: 'Give control back',
    description:
      'Give control of the project browser back when you are done. Tabs you opened ' +
      'are closed.',
    inputSchema: schema({}),
  },
  {
    name: 'browser_task',
    // Decided action by action inside the gateway, like the step tool each action stands for
    // (task/policy-common.ts categoryOfStep); `write` is what the call is before it runs.
    category: 'write',
    title: 'Do a browser task (fast path)',
    description:
      "Hand a multi-step job in this project's browser to its fast decision model: it reads " +
      'the page, picks each next action and does it itself, all in one call — much cheaper ' +
      'and faster than many snapshot/click rounds. Best for one observable outcome: navigating ' +
      '("Open the invoices of September"), filling and sending a form with known values, ' +
      'setting filters. Put every string it may type or choose into `values` with a meaningful ' +
      'key ({"email": "…", "postal_code": "…"}); it never invents text, and never put a password ' +
      'or code there (browser_login fills logins). Supply independent success criteria for every plan step; done means ' +
      'all supplied criteria matched a fresh observation. Without criteria, the task hands back to the standard agent. Returns completion,' +
      ' or hands back — needs_agent, needs_login, needs_confirmation, ' +
      'needs_approval, stuck, blocked, error — with the reason, the candidates and the page ' +
      'snapshot, so you continue with the step tools. Every action is approved like the step ' +
      'tool it stands for (a submit is a send). mode "read" only scrolls and waits.',
    inputSchema: schema(
      {
        goal: {
          type: 'string',
          description:
            'The outcome, in plain words, as one observable result ("The search results for X are shown").',
        },
        values: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description: 'Every text it may type or option it may choose, by a meaningful key.',
        },
        success: {
          type: 'object',
          additionalProperties: false,
          description:
            'Independent observed outcome. All supplied criteria must match. Choose criteria covering the full requested goal; no secrets, selectors or code.',
          properties: {
            url: {
              type: 'string',
              description: 'Exact final HTTP(S) URL, including query and fragment.',
            },
            textIncludes: {
              type: 'array',
              minItems: 1,
              maxItems: 10,
              items: { type: 'string', maxLength: 500 },
              description: 'Case-sensitive substrings of currently visible page text.',
            },
            fields: {
              type: 'array',
              minItems: 1,
              maxItems: 10,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['label'],
                properties: {
                  label: { type: 'string' },
                  value: { type: 'string' },
                  checked: { type: 'boolean' },
                },
              },
              description:
                'Uniquely labelled visible fields; exact observed value and/or checked state.',
            },
          },
        },
        plan: {
          type: 'array',
          minItems: 1,
          maxItems: 12,
          description:
            'Ordered atomic steps planned by the standard agent. Jev verifies each step before the next. On uncertainty or failed verification, continue from the returned snapshot.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['goal', 'success'],
            properties: {
              goal: { type: 'string', description: 'One observable action or outcome.' },
              success: {
                type: 'object',
                additionalProperties: false,
                description: 'Independent success criterion for this step.',
                properties: {
                  url: { type: 'string' },
                  textIncludes: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 10,
                    items: { type: 'string' },
                  },
                  fields: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 10,
                    items: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['label'],
                      properties: {
                        label: { type: 'string' },
                        value: { type: 'string' },
                        checked: { type: 'boolean' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        failedAttempts: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description:
            'Pass 1 only when retrying a previously failed plan; after another failure the whole task goes to the standard agent.',
        },
        startUrl: {
          type: 'string',
          description: 'Open this address first (the same rules as browser_navigate).',
        },
        maxSteps: { type: 'number', minimum: 1, maximum: 60, default: 20 },
        mode: {
          type: 'string',
          enum: ['act', 'read'],
          default: 'act',
          description:
            '"read" never changes the page: it only scrolls and waits, and stops before any click; "act" clicks, types, selects and sends.',
        },
        allowIrreversible: {
          type: 'boolean',
          description:
            'Go on even when the next step looks hard to undo (an order, a payment, a message). Only when the user asked for exactly that.',
        },
      },
      ['goal'],
    ),
  },
  {
    name: 'browser_check',
    category: 'read',
    title: 'Check the page (yes/no)',
    description:
      "Ask the project's decision model a yes/no question about the current page and get the " +
      'probability that the answer is yes (0–1). A cheap way to verify an outcome after ' +
      'browser_task ("Does the cart show 1 item?").',
    inputSchema: schema({ question: { type: 'string' } }, ['question']),
  },
  {
    name: 'browser_choose',
    category: 'read',
    title: 'Choose from options about the page',
    description:
      "Ask the project's decision model which of the given options is true of the current page; " +
      'returns the chosen option and the probability of each.',
    inputSchema: schema(
      {
        question: { type: 'string' },
        options: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 50 },
      },
      ['question', 'options'],
    ),
  },
  {
    name: 'browser_handover',
    category: 'read',
    title: 'Ask the owner to take over',
    description:
      'Ask the owner to take over (a CAPTCHA, a question only they can answer). Shows a ' +
      'card in the live view and in Helena, and waits up to timeoutSec until the owner ' +
      'has taken over and given control back.',
    inputSchema: schema(
      {
        reason: { type: 'string', description: 'What the owner should do, in one sentence.' },
        timeoutSec: { type: 'number', minimum: 30, maximum: 1800, default: 300 },
      },
      ['reason'],
    ),
  },
];

// The tools that only concern the lock, the owner and the downloads Helena already holds;
// every other tool acts on, or reads, pages of the open web (MCP's openWorldHint).
const LOCAL_TOOLS = new Set([
  'browser_status',
  'browser_acquire',
  'browser_release',
  'browser_handover',
  'browser_downloads',
]);

export const BROWSER_TOOLS: ToolDef[] = DEFINED_TOOLS.map((tool) => ({
  ...tool,
  annotations: { openWorldHint: !LOCAL_TOOLS.has(tool.name), ...tool.annotations },
}));

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

// The tools of the fast path (docs/helena-decisions/browser-task.md §3.2): listed and accepted
// only where the project's "Browser-Steuerung" names a decision model.
export const TASK_TOOLS = new Set(['browser_task', 'browser_check', 'browser_choose']);

export function toolByName(name: string): ToolDef | undefined {
  return BROWSER_TOOLS.find((tool) => tool.name === name);
}

// The category a call is decided on: the tool's own, unless what it actually does is more:
// a click on a form's submit control, typing with submit, or Enter in a form field sends the
// form ('send'). `submitsForm` is the session's answer for the element the call acts on.
export function categoryOf(tool: ToolDef, submitsForm: boolean): ActionCategory {
  if (
    submitsForm &&
    (tool.name === 'browser_click' ||
      tool.name === 'browser_type' ||
      tool.name === 'browser_press_key')
  ) {
    return 'send';
  }
  return tool.category;
}

const TARGET_KEYS = ['target', 'startTarget', 'endTarget', 'usernameTarget', 'passwordTarget'];

// A ref as agents write it: "e5", "f1e5", Hermes' own "@e5", or the snapshot's "[ref=e5]".
function cleanRef(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return value
    .trim()
    .replace(/^\[?(?:ref=)?@?/, '')
    .replace(/\]$/, '');
}

// The standard's parameter names for what older Playwright MCP versions and Hermes' own
// browser tool call `ref`, `fromRef`/`toRef` (and our first draft `usernameRef`/`passwordRef`),
// and refs in any of the spellings above.
export function normalizeArgs(args: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(args ?? {}) };
  const alias = (from: string, to: string) => {
    if (out[to] === undefined && out[from] !== undefined) out[to] = out[from];
    delete out[from];
  };
  alias('ref', 'target');
  alias('fromRef', 'startTarget');
  alias('toRef', 'endTarget');
  alias('usernameRef', 'usernameTarget');
  alias('passwordRef', 'passwordTarget');
  for (const key of TARGET_KEYS) if (key in out) out[key] = cleanRef(out[key]);
  if (Array.isArray(out.fields)) {
    out.fields = out.fields.map((field) =>
      field && typeof field === 'object' ? normalizeArgs(field as Record<string, unknown>) : field,
    );
  }
  return out;
}
