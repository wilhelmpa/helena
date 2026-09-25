# Decision: the chat UI on standard components

Status: accepted, 2026-09-24 · Branch: `hub/chat-standards`

Helena's agent chat (the `/chat` page, the project chat and the chat tool of the tool panel)
is built from standard building blocks, with a thin Helena layer only where no standard
covers the need. This file records what carries which part, the versions checked, and the
alternatives that were rejected.

Constraints that shaped the choice:

- The browser never talks to a model. A question is stored by the Helena API, a runner answers
  it through Hermes (or Claude Code / Codex), and the answer is read back as **AG-UI** events.
  That wire stays.
- State in the browser is already the **Vercel AI SDK** (`ai` 7.0.112, `@ai-sdk/react`
  4.0.115, `useChat` over a custom `ChatTransport`).
- The UI kit is **shadcn/ui** (Tailwind 4, CSS variables), including shadcn's own chat
  primitives (`@shadcn/react` 0.3.1: Message, Bubble, MessageScroller, Marker, Attachment).
- The LAN runs on plain http until the Cloudflare tunnel exists: no Clipboard API, no
  microphone.
- Licences must fit AGPL-3.0.

## Summary

| Building block | Standard | Helena layer |
|---|---|---|
| Chat state, streaming, stop, resume, regenerate | AI SDK UI `useChat` + `ChatTransport` | `PlanChatTransport` (send/retry/cancel on the Helena API), `usePlanChat` (restore, queue, versions) |
| Wire format | AG-UI 1.0 (`@ag-ui/core` types; the runner emits 1.0 events) | `AgUiChunkMapper`: AG-UI events → AI SDK `UIMessageChunk`s (~150 lines; no library does this direction) |
| Answer stream | Server-sent events (WHATWG HTML): `eventsource-parser`, resume with `Last-Event-ID`; the API wakes a stream with Postgres `LISTEN/NOTIFY` | the reconnect loop (backoff, the server's `retry:`) |
| Message model | AI SDK `UIMessage` parts: `text`, `reasoning`, `dynamic-tool`, transient `data-turn` | metadata (time, model, tokens, versions, attachments) |
| Transcript scroll | shadcn `MessageScroller` (stick to bottom, turn anchoring, keep position when older messages load, `content-visibility`) | – |
| Message layout | shadcn `Message`, `Bubble`, `Marker` (status lines, day separators), `Attachment` | – |
| Markdown while streaming | **Streamdown** 2.6 (incomplete-Markdown repair, memoized blocks, GFM tables with copy/download, code blocks, word fade-in) + `@streamdown/code` (Shiki) + `@streamdown/mermaid`, both loaded only when an answer needs them | renderers for Helena's own fences (`chart`, `issue-import`), artifact cards, file markers |
| Reasoning, tool calls, tool groups, queue, suggestions, sources, prompt input, dictation | **AI Elements** (Vercel, Apache-2.0), copied as source into `apps/web/src/components/ai-elements/` the shadcn way | adapted to Helena's type scale, colours, i18n and plain-http rules |
| Copy buttons | Clipboard API | on plain http a small polyfill backs `navigator.clipboard.writeText/write` with `copyText`'s `execCommand` fallback, so Streamdown's own buttons work too |
| Dictation / read aloud | Web Speech API (`SpeechRecognition`, `speechSynthesis`) | secure-origin hint; server STT/TTS through Hermes proposed (see Voice) |

## 1. Components: AI Elements on top of shadcn's chat primitives

**Chosen:** [AI Elements](https://github.com/vercel/ai-elements) (Vercel, Apache-2.0, CLI
`ai-elements` 1.9.0, repository state 2026-08-21, distributed as a shadcn registry at
`https://elements.ai-sdk.dev/api/registry/<name>.json`). AI Elements is the component set
the AI SDK team ships for `UIMessage` parts. Like every shadcn component it is copied into
the project and owned there, so Helena adapts it (13/12/14 px type, `--card`/`--accent`
surfaces, German-first i18n, `copyText`) without forking a package.

Used (in `components/ai-elements/`, each file keeps the Apache-2.0 notice):

| Element | For |
|---|---|
| `MessageResponse`, `MessageActions`, `MessageAction` | an answer's Markdown, the action row under a message |
| `Reasoning`, `ReasoningTrigger`, `ReasoningContent` | the model's thinking: open while it streams, closed afterwards |
| `Tool`, `ToolHeader`, `ToolContent`, `ToolInput`, `ToolOutput` | one tool call with arguments and result |
| `Task`, `TaskTrigger`, `TaskContent` | the tool calls between two stretches of text, folded into one line ("3 tool calls") |
| `Queue`, `QueueItem`, … | messages written while an answer is still coming |
| `Suggestions`, `Suggestion` | the choices of a Hermes `clarify` question, over the input |
| `Sources`, `SourcesTrigger`, `SourcesContent` | tasks, files and links an answer named, folded into "3 sources" |
| `PromptInput` (form, textarea, header, footer, tools, button, submit) | the composer; files dropped or pasted go straight to the vault (AI Elements' blob-URL attachments are left out) |
| `SpeechInput` | dictation |

Not used, with the reason:

- `Conversation` (`use-stick-to-bottom`, MIT): shadcn's `MessageScroller`, already in the
  project, does the same and more: it anchors a new turn, keeps the reader's place when
  older messages are prepended, skips off-screen rows with `content-visibility`, and its
  content is an ARIA `log`.
- `Message`/`MessageContent`: shadcn's `Message` + `Bubble` are the same idea from the UI kit
  itself; one message layout, not two.
- `Shimmer` (needs `motion`): the `shimmer` utility of shadcn's globals does it in CSS.
- `CodeBlock` (direct Shiki): Streamdown's code plugin renders fences, tool arguments and
  results alike.
- `MessageBranch`: switches between branches held in the browser; Helena's versions live on
  the server (`showChatVersion`), so the small `ChatBranchNav` stays.
- `Context` (needs a model's context window and `tokenlens`): Helena knows the used tokens,
  not the window; `AgentContextSize` stays until the catalog carries window sizes.
- `ModelSelector`, `Confirmation`: the model picker reads the runner's catalog, and an
  approval is decided through Helena's approvals API (not the AI SDK's tool-approval states,
  which Hermes does not produce); both keep their existing Helena components.

**Rejected alternatives:**

- **assistant-ui** (MIT, `@assistant-ui/react`, runtimes incl. `@assistant-ui/react-ag-ui`):
  brings its own runtime (thread, composer, branches) that would sit beside or replace
  `useChat`, a second state layer. Its AG-UI runtime expects an AG-UI agent endpoint
  (`HttpAgent`, one request per run), while Helena's API stores a question and lets the
  browser follow and resume the answer by cursor; the adapter would have to be written
  anyway. Its styled layer is again a shadcn registry, so nothing is gained over AI Elements.
- **CopilotKit** (MIT, creator of AG-UI): needs its `CopilotRuntime` between browser and
  agent, a second backend beside the Helena API, and brings its own chat state and
  components (`CopilotChat`). Helena already is the runtime; AG-UI is used as the wire, which
  is the part of CopilotKit's work that matters here.
- Keeping the hand-written disclosures and composer: they duplicated what AI Elements
  provides and had no incomplete-Markdown handling, no code/table controls and no shared
  look with the future transcript viewer.

## 2. Markdown: Streamdown

**Chosen:** [Streamdown](https://github.com/vercel/streamdown) 2.6.0 (Apache-2.0), the
renderer AI Elements' `MessageResponse` wraps. It was already a dependency but unused: the
chat re-parsed the whole answer with `marked` + DOMPurify on every token and set it as HTML.

What it brings: `remend` closes unterminated Markdown while it streams (no flashing `**`),
the text is split into blocks and finished blocks are memoized, GFM tables with copy (CSV,
TSV, Markdown), download and fullscreen, code blocks with line numbers, copy and download,
Mermaid diagrams, per-block text direction (`dir="auto"`), `rehype-sanitize` + `rehype-harden`
against injected HTML, and a word fade-in (`animated`) that makes the runner's 150 ms batches
read as a smooth stream. Code highlighting is `@streamdown/code` (Shiki, MIT; grammars load
per language), diagrams `@streamdown/mermaid` (mermaid, MIT). Both are imported only when an
answer contains a code fence or a Mermaid fence, so an answer of plain prose loads neither.

Helena's own fences stay: ` ```chart ` (drawn with the existing ChartBlock) and
` ```issue-import ` (the import review card) are Streamdown custom renderers; artifact fences
(` ```html `, ` ```svg ` … marked as artifacts) still become cards that open the artifact
panel; `[file: "x" (attachment id: …)]` markers still become download links.

Rejected: `react-markdown` (no streaming repair, no block memoization), keeping `marked` +
DOMPurify for the chat (re-renders everything per token, no controls).

## 3. AI SDK features

| Feature | Use |
|---|---|
| `ChatTransport` | kept: `sendMessages` (send, regenerate) and `reconnectToStream` (resume) over the Helena API |
| `resumeStream` / `reconnectToStream` | kept for answers running when a chat is opened or whose stream was lost. `useChat({ resume: true })` is not used: it fires on mount, before the stored transcript is loaded |
| `throttle` | new: 50 ms, so one runner batch of several deltas is one render |
| message parts | `text`, `reasoning`, `dynamic-tool` (tools arrive at run time from Hermes/MCP, so they are dynamic), transient `data-turn` (the server ids of a new question and thread) |
| tool approval (`approval-requested`, `addToolApprovalResponse`) | not used: approvals are Helena's own, decided in the approvals API and shown as the approval card |
| `sendAutomaticallyWhen` | not used: it resubmits after client-side tool results; Helena's queue sends *new* questions and has its own rules (stops after a failed answer) |
| file parts, `source-url`/`source-document` parts | not yet: attachments are vault paths sent in the request body. Sources are derived from the answer's text; when the runner reports citations (package K, "Second Brain") they become source parts and the same `Sources` element shows them |
| `readUIMessageStream` | used in tests to read what the transport produces |
| `transcribe`, `generateSpeech`, `experimental_useRealtime` | rejected, see Voice |

## 4. AG-UI and the stream

The answers are AG-UI events. There is no library that turns AG-UI events into AI SDK UI
chunks in the browser (`@ag-ui/vercel-ai-sdk` goes the other way: an AI SDK agent served as
AG-UI), so the mapper stays Helena's, typed with `@ag-ui/core` 1.0 (MIT; its `EventType`
names and `contentToText`).

AG-UI 1.0 conformance (standards audit RUN-02 / WEB-10 / CHAT-1):

- **Runner** (`packages/runner/src/agui.ts`): reasoning is a 1.0 reasoning message
  (`REASONING_START`, `REASONING_MESSAGE_START/CONTENT/END`, `REASONING_END`) instead of the
  removed `THINKING_TEXT_MESSAGE_CONTENT`; a failed tool says so in the result's
  `metadata: { isError: true }` (MCP's name for it; AG-UI has no error field) instead of a
  non-standard `isError` on the event; `RUN_STARTED` carries `protocolVersion: "1.0"`.
- **API** accepts both the 1.0 names and the old ones for one release, so a runner that
  predates this keeps working.
- **Web** reads both, plus the `*_CHUNK` shorthands and results given as content parts.
- **SSE**: the browser parses the stream with `eventsource-parser` (multi-line `data:`,
  CRLF, comments, `retry:`) instead of splitting it by hand, and resumes a dropped stream
  with the `Last-Event-ID` header, which the server's `id:` lines are for; the API reads it
  before the old `?after=`. `@microsoft/fetch-event-source` was rejected (last release 2021);
  the browser's `EventSource` cannot send the session cookie cross-origin with the control
  the reconnect loop needs.
- **Wake-up**: a waiting stream no longer polls the database every 100 ms. Reporting events,
  finishing and stopping an answer send a Postgres `NOTIFY` (inside the write's transaction),
  one `LISTEN` per API process wakes the streams following that answer, and the table stays
  the log they read from. The poll remains as a 1 s fallback for what no `NOTIFY` covers
  (a janitor closing an answer, a LISTEN connection that is down).

## 5. Voice

Facts that decide it:

- `SpeechRecognition` (Chrome, Edge, Safari) needs the microphone, and browsers grant the
  microphone only to a secure origin. The same holds for `getUserMedia`/`MediaRecorder`.
  **So no microphone path works over plain http, whether the text is recognized in the
  browser or on the server.** Only a phone's file picker (`<input type="file"
  accept="audio/*" capture>`) can hand over an audio file recorded by the OS on plain http.
- `speechSynthesis` needs no permission and works on http.
- The AI SDK's `transcribe`/`generateSpeech` call a speech model from Helena's server, and
  `experimental_useRealtime` connects the browser to a provider. Both contradict "Helena
  calls no model" and would put provider keys into Helena.
- Hermes has speech built in: STT with faster-whisper (local), Groq, OpenAI or Mistral
  Voxtral, TTS with Edge TTS, Piper, NeuTTS, KittenTTS, ElevenLabs or OpenAI.

**Superseded (2026-09-25) by `voice.md`:** dictation and a hands-free conversation mode run on
Lokale KI (Whisper on the NPU for speech to text, class `speech` for a local voice), with the Web
Speech API and `speechSynthesis` as the path while those classes are off. The Hermes-runner
proposal that stood here was dropped: Lokale KI already serves Whisper behind the API with its key
and policy. On plain http the fix stays HTTPS (until then Chrome's "Insecure origins treated as
secure" flag, which the kiosk already sets).

## 6. Keyboard, scrolling and accessibility

- Enter sends; Shift+Enter and ⌘/Ctrl+Enter break the line; Escape stops the answer; ↑ in an
  empty composer edits the last own message (the claude.ai/ChatGPT convention; neither the AI
  SDK nor AI Elements define it, so it is a small handler, tested as a pure function:
  `features/ai-chat/utils/composerKeys.ts`).
- The transcript opens at its end, follows a streaming answer only while the reader stays at
  the bottom, and lets go when they scroll up (`MessageScroller` with `autoScroll`). A
  question sent from here on is a scroll anchor: it moves to the top so its answer has room.
  Questions the chat opened with are not anchors — the scroller would otherwise take each of
  them for an anchor still to show and jump back up to it (the bug the chat had in longer
  threads).
- The transcript is shadcn's ARIA `log` (additions announced); a message that is still
  streaming carries `aria-busy`, so a screen reader reads it once it is complete instead of
  word by word; the composer's status line ("Home schreibt …") is a `status` region.
- New words fade in only when the reader has not asked for reduced motion.

## 7. Shared building blocks

The message pieces are not chat-only. `components/ai-elements/` (the adapted AI Elements) and
`components/agent-message/` (`AgentMarkdown`, `AgentMessageParts`, `AgentToolGroup`: a
`UIMessage` rendered with reasoning, tool groups and Markdown) are meant for every place that
shows what an agent did, first the transcript and run timeline of hub/hermes-in-helena
("Gläserne Läufe"), which converts its data to the same `UIMessage` parts.

## Licences

| Package | Licence |
|---|---|
| AI Elements (copied source) | Apache-2.0 |
| streamdown, @streamdown/code, @streamdown/mermaid | Apache-2.0 |
| shiki, mermaid | MIT |
| @shadcn/react, shadcn/ui | MIT |
| ai, @ai-sdk/react | Apache-2.0 |
| @ag-ui/core | MIT |
