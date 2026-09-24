# Decision: the browser tools agents use (the "Projekt-Browser" gateway)

Status: decided 2026-09-24 (branch `hub/agent-browser-mcp`). This is the building block "Browser"
from `docs/volition-helena-oss.md` §3b, tool side. The live view is a separate decision
(`browser-live-view.md`, hub/browser-live-4).

## What has to be decided

Every agent (Hermes, Claude Code, Codex) drives its project's own browser through one MCP server,
`projekt-browser`, served by the gateway in the browser router. The gateway works on a browser that
is shared: the owner watches and can take over, and several agents work in it one after another.
Some layers exist only in Helena:

- the control lock and the owner's takeover;
- logins from Zugänge, so passwords and 2FA codes never pass through a prompt;
- the handover card ("Bitte übernehmen");
- redaction of secrets in text, snapshots and screenshots;
- the project's domain rules;
- the action category of every call, which Helena's policy decides on;
- downloads into the project's Inbox;
- uploads the agent's side reads with the agent's own rights.

The question from §3b: should the gateway use the standard `@playwright/mcp`, embedded or wrapped,
and add only these layers on top? Or are our own tools clearly better? The goal is tool names and
semantics that agents already know.

## Candidates

| | `@playwright/mcp` (Microsoft) | Chrome DevTools MCP (Google) | browser-use | Hermes' built-in `browser` toolset | Stagehand |
|---|---|---|---|---|---|
| License | Apache-2.0 | Apache-2.0 | MIT | MIT (Hermes) | MIT |
| Maturity | Most used browser MCP: 37.5k stars. 0.0.82 released 2026-09-18. The tools live in `playwright-core` itself (`src/tools/backend`), and the npm package is a thin wrapper | 1.10.1 released 2026-09-23. Built for debugging (performance traces, emulation) | Python agent framework with its own agent loop | Whatever Hermes agents know today | TypeScript SDK (`act`/`extract`/`observe`) that calls an LLM inside the tool |
| Element addressing | `target`: a ref from the accessibility snapshot (`e5`, `f1e5`), or a selector | `uid` from its own snapshot | numeric index of a highlighted DOM element | `@e5` refs (agent-browser) | natural language |
| Engine | Playwright: `page.ariaSnapshot({mode:'ai'})`, `aria-ref=` locators | Puppeteer. Needs the Runtime domain, which bot detection sees | Playwright/CDP, in Python | agent-browser CLI | Playwright plus an LLM |
| Fit for us | the standard names and semantics | a different vocabulary for the same things; devtools focus | no MCP tool standard; its own loop duplicates Hermes | these are the tools the gateway replaces | model calls inside the gateway contradict "Hermes does all AI work" |

**Important finding:** patchright-core 1.63.0, the Playwright fork the gateway already uses, ships
the complete Playwright MCP backend:

- `require('patchright-core/lib/coreBundle').tools` exports `BrowserBackend`, `browserTools`,
  `filteredTools` and `createConnection`;
- the tools are identical to `@playwright/mcp`'s;
- its snapshot is the same `ariaSnapshot({mode:'ai'})`, with the same `f1e5` refs the gateway
  already produces.

So "embed the standard" needs no new package. It was evaluated in earnest.

## Option A: embed Playwright's `BrowserBackend`, with our layers around `callTool`

What we would gain:

- upstream maintenance of about 15 page tools;
- Playwright's modal-state handling;
- `waitForCompletion`: after an action, wait for the requests it caused.

What speaks against it:

1. **Playwright MCP is "not a security boundary"** (its README). Several default tools are
   unacceptable in a browser that is shared and holds sessions:
   - `browser_evaluate`, and `browser_run_code_unsafe` (the README calls it "RCE-equivalent";
     here it would run as the browser user, who can read every project's browser profile);
   - `browser_file_upload` resolves `paths` on the server side. As the browser user, an agent
     could upload another project's cookies database;
   - downloads are saved to a server output directory, and the response reveals the server path;
   - `browser_close` and `browser_resize` would close the project's browser or fight over its
     window, but the window belongs to the lock and the live view;
   - `browser_tabs` closes any tab, including the owner's.

   About half the default surface would have to be removed or replaced.
2. **The embeddable API is internal.** `lib/coreBundle` → `tools.BrowserBackend` is not a
   documented API. It changed shape within recent versions:
   - `ref` became `target`;
   - the snapshot after an action moved into a file;
   - some tools became `skillOnly`.

   Our security layer would depend on internals that move with every minor release.
3. **The public API does not fit.** `@playwright/mcp`'s documented `createConnection(config,
   contextGetter)` is a whole MCP server built on upstream `playwright-core`, not patchright:
   - we would lose patchright's stealth patches;
   - two Playwright client copies would drive one CDP browser;
   - its per-client state (current tab, console, downloads) does not match "one browser, many
     agents, one lock".
4. **Our layers work on the page, not around the call.** Most of what Helena adds happens between
   resolving the element and acting on it. A wrapper around `callTool` cannot get in there, so each
   would mean patching the backend or parsing its markdown responses. The layers are:
   - the credential-field guard ("use browser_login");
   - redacting values in the snapshot;
   - masking login fields inside the screenshot PNG;
   - human-like pointer and keystrokes (project setting "menschliche Eingabe");
   - detecting that a click submits a form (the 'send' category);
   - stale-ref detection;
   - per-agent tab ownership.
5. **The implementation is thin either way.** Both call the same Playwright API on the same
   snapshot. The value of the standard is its *surface*: names, parameters, descriptions and the
   shape of the answers, which models have seen countless times. The value of the implementation
   underneath is small.

## Option B (decided): the standard surface over our own guarded implementation

**The gateway speaks Playwright MCP.**

- Every tool that has a counterpart in `@playwright/mcp` has its name, its parameters (`target`
  plus the optional `element` description, `startTarget`/`endTarget`, `values`, `accept`/
  `promptText`, `action`/`index` for tabs, `paths`, `level`, `time`/`text`/`textGone`, `fields`)
  and its description.
- Answers use its sections: `### Result`, `### Page` (`- Page URL:`, `- Page Title:`),
  `### Open tabs` (`- 0: (current) [title](url)`), `### Modal state` (`- ["confirm" dialog
  with message "…"]: can be handled by browser_handle_dialog`) and `### Events`.
- The implementation underneath stays ours: the tested `PatchrightGatewaySession`.
- **A parity test** (`playwright-parity.test.ts`) loads the tool table of the pinned
  `patchright-core` and checks every adopted tool: name, required parameters, parameter names,
  and enums as a subset. A patchright upgrade that changes the standard fails the test.

| Standard tool (`@playwright/mcp` 1.63) | Gateway | Before |
|---|---|---|
| `browser_navigate` {url} | same | same |
| `browser_navigate_back` | same | `browser_back` |
| `browser_reload` | same | same |
| `browser_snapshot` {target?, depth?} | same (no `filename`/`boxes`) | no parameters |
| `browser_click` {element?, target, button?, doubleClick?, modifiers?} | same | `ref`, button |
| `browser_type` {element?, target, text, submit?, slowly?} | same. Replaces the field's content like Playwright's `fill`, with real keystrokes | appended at the click position |
| `browser_select_option` {element?, target, values} | same | `browser_select` |
| `browser_hover` {element?, target} | same | `ref` |
| `browser_drag` {startElement?, startTarget, endElement?, endTarget} | same | `fromRef`/`toRef` |
| `browser_press_key` {key} | same | `browser_press` |
| `browser_take_screenshot` {element?, target?, fullPage?} | same; always PNG with login fields masked | `browser_screenshot` |
| `browser_tabs` {action: list/new/close/select, index?, url?} | same | open/focus/close with our own tab ids |
| `browser_handle_dialog` {accept, promptText?} | same | `browser_dialog` {action} |
| `browser_file_upload` {paths?} | same, plus an optional `target` (a file input or the button that opens the chooser) | `browser_upload` {ref, path} |
| `browser_console_messages` {level?} | same | `browser_console` {limit} |
| `browser_network_requests` {static?, filter?} | same; `filter` is a substring | `browser_network` {limit} |
| `browser_wait_for` {time?, text?, textGone?} | same | new |
| `browser_fill_form` {fields[]} | same | new |
| `browser_find` {text} | same (text only) | new |

**Helena's own tools** have no standard counterpart:

- `browser_status`, `browser_acquire` and `browser_release`: the lock;
- `browser_handover`: the owner card;
- `browser_login` and `browser_login_code`: Zugänge. They take `usernameTarget`/`passwordTarget`
  and `target` in the standard's style;
- `browser_downloads`: the Inbox;
- `browser_scroll`: Playwright only has `browser_mouse_wheel` behind its `vision` capability.
  Hermes agents know `browser_scroll`.

**Semantics taken from the standard** where ours differed:

- **Implicit control:** the first page action takes control when the browser is free. Playwright-
  trained agents navigate straight away. `browser_acquire` remains, for waiting while someone else
  works.
- **Page state after every action** (URL, title, open tabs, modal state, downloads). Upstream
  1.63 no longer puts the snapshot itself inline after an action: it writes it to a file and links
  it. Our agents cannot read the gateway's files, so we return no snapshot, and the agent calls
  `browser_snapshot`.
- **The file chooser as a modal state:** a click that opens one says so, and `browser_file_upload`
  answers it.
- `browser_type` **replaces** the field's content.
- `element`, the human-readable description the standard asks for "to obtain permission", goes
  to Helena's policy and onto the approval card. That is exactly what the standard intended.

**Deliberately not offered:**

- `browser_evaluate`, `browser_run_code_unsafe` and route/storage/cookie tools: script, session
  theft;
- `browser_network_request`: full headers and bodies, which carry cookies and tokens;
- `browser_close` and `browser_resize`: the browser and its size belong to the lock and the live
  view;
- `pdf`/`tracing`/`video` (these write server files) and the `vision` coordinate tools. They can
  come later as opt-in tools that write into the Inbox.

**Deviations from the standard, and why:**

- `target` takes refs only, no selectors. Our guards check the element a ref resolves to; refs are
  what agents use anyway.
- Refs from Hermes' built-in tool (`@e5`) and the parameter name `ref` (older `@playwright/mcp`
  versions) are accepted too.
- `browser_file_upload`'s `paths` are read by the agent's side (the shim, with the agent's own
  rights) and sent as bytes. The gateway never opens a path an agent names.
- `filter` and `browser_find` match text, not a regular expression, so an agent's pattern
  cannot hang the router (ReDoS).
- Console entries come from the CDP Log domain: failed requests, security and blocked content.
  The page's own `console.log` needs the Runtime domain, which patchright avoids because bot
  detection looks for it.

## What we took from the standard's code

These are ideas, not code, and Apache-2.0 would allow copying anyway:

- the modal-state wording;
- the section layout of answers;
- after an action, waiting for the requests it started to finish, with a short settle time
  (`waitForCompletion`), instead of a fixed `networkidle` wait.

## When to revisit

- If Playwright publishes a documented, stable way to embed its tool backend with hooks between
  resolve and act, look at it again.
- If patchright ever drops the tools from its bundle, the parity test turns into a snapshot of
  the schemas in the repo.
