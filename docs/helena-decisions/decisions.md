# Decision: typed decisions in Helena — the decide service, the model router, mail classification and receipt matching

Status: built on branch `hub/decisions` (2026-09-25); evals partly measured (§8), the GPU run is
pending. Building blocks "Entscheidungen" and "Finanzen/Belege" of `docs/volition-helena-oss.md`.
Extends `browser-task.md` (decision backends, System One client, Laya) and plugs into
`local-ai-platform.md` (hub/local-ai: Lemonade, the "Lokale KI" policy).

Owner, 2026-09-25 (after Alex Sprogis' video "Deshalb solltest du Jev und Claude kombinieren!"):
"das müssen wir hinbekommen". Jev (TypeSafe) is a "system one" model: it answers typed questions
(one of declared options, with probabilities) in milliseconds instead of writing text. The video
shows three uses: a model router for Claude Code, a mail classifier, receipt matching. TypeSafe
paused new sign-ups on 22 Sep, so everything had to work with local backends first and with Jev
Cloud as soon as the owner has a key.

All fetched material (TypeSafe docs, the video's companion repository, SemIf-OpenJev, llama.cpp,
Lemonade, Laya, bank format specs) was read as untrusted data.

## 0. Kurzfassung (für den Owner)

- **Eine Stelle für getypte Entscheidungen:** `decide({Frage, Optionen, Kontext, Art})` → Wahl,
  Wahrscheinlichkeiten, Sicherheit, Backend, Dauer. Jede Art ("Modellwahl", "Mail einordnen",
  "Belege zuordnen", "Allgemeine Entscheidungen") hat in **Home → Entscheidungen** ihre
  Verbindung (aus den Zugängen), einen Ersatz, eine Schwelle, ein Zeitlimit (2–8 s) und einen
  Schalter. **Einschalten geht erst nach einer bestandenen Auswertung** auf genau dieser
  Verbindung. Unter der Schwelle, bei Zeitüberschreitung oder Fehler passiert, was ohne
  Entscheidung passiert wäre.
- **Backends:** Jev (TypeSafe, sobald ein Schlüssel da ist), Jev über Vercel, Laya (lokal, schon
  installiert) und neu **"Lokales Sprachmodell (Logit-Auswertung)"**: ein kleines Sprachmodell
  (Qwen3.5-4B) auf der lokalen KI liest die Wahrscheinlichkeiten der Antwortbuchstaben aus einem
  einzigen Rechenschritt aus — die Idee von SemIf-OpenJev, ohne dessen Python-Stack. Dazu eine
  JSON-Antwort als Rückfall.
- **Ergebnis der Messungen bisher (CPU, bevor der Rechner entlastet werden musste):** Laya mit dem
  allgemeinen Checkpoint ist auf deutschen Texten zu unsicher (52–60 % richtig, fast nichts über
  der Schwelle) — er ist nur für Englisch trainiert. **Qwen3.5-4B per Logit-Auswertung trifft die
  allgemeinen Fragen zu 96 %** (100 % Trefferquote über der Schwelle) und die Frage "braucht die
  Anfrage den bisherigen Chat?" zu 90 %; die Einstufung schwer/leicht beim Router nur zu 57 %.
  Der GPU-Lauf mit allen Arten steht aus (§8).
- **Modellwahl für Helenas Agenten:** vor einem Lauf oder einer Chat-Antwort ohne eigenes Modell
  kann ein günstigeres Modell derselben Laufzeit übernehmen — nur wenn sicher, nur wenn die Anfrage
  für sich steht, nie teurer als eingestellt (außer du erlaubst es je Agent). Aus, bis du es je
  Agent einschaltest; je Projekt abschaltbar. Jeder Lauf und jede Antwort zeigt "Modellwahl: X → Y
  · Grund".
- **Für dein eigenes Claude Code:** ein Hook + `/router` wie im Video, aber er fragt Helena (also
  Laya/lokal oder Jev, wie eingestellt) statt TypeSafe direkt. Liegt als Dateien + Installer bereit;
  **du entscheidest, ob du ihn installierst.**
- **Mail einordnen:** neue Mail bekommt Projekt, Art (Rechnung/Beleg, Termin, Anfrage, Newsletter,
  Benachrichtigung, Privat, Werbung, Sonstiges), Priorität, "braucht Antwort", "Aufgabe nötig".
  Handlungen sind aus, Vorschlag (ein Klick von dir = Freigabe) oder automatisch.
- **Belege zuordnen (v1):** Kontoauszüge als CAMT.053/052/054 oder CSV der deutschen Banken,
  Belege aus Mail-Anhängen, Uploads und dem Vault (E-Rechnungen ZUGFeRD/XRechnung direkt aus dem
  XML, sonst Text/OCR). Regeln filtern, das Entscheidungsmodell wählt unter den Kandidaten, sichere
  Paare werden zugeordnet, unsichere kommen in "Prüfen". Export je Monat als CSV + ZIP für den
  Steuerberater.

## 1. What had to be decided

1. One way to ask a typed decision, for Helena's own features, agents (MCP) and workflows, over
   every backend, with a failsafe and without ever replacing a caller's default behaviour.
2. Which backends answer it while Jev Cloud is closed: Laya's checkpoints, a logit readout of a
   small local decoder (SemIf-OpenJev's method), a constrained JSON answer.
3. Where the decision is gated (evals), logged (privacy) and counted (usage, cost).
4. The three use cases of the video in Helena's terms, plus a workflow step and an MCP tool.
5. The safety fix of `browser_task`'s read mode and the jev-browser crash (§9.1).

## 2. Candidates

### 2.1 The decision interface

| | System One (`/v1/systemone`) | AI SDK `experimental_evaluate` | own "classify" prompt per feature |
|---|---|---|---|
| Shape | state + named questions (`choice` with criteria, `noul`, `score`), answers with probabilities | evaluation model abstraction, experimental | free text, parsed per feature |
| Backends | TypeSafe Jev, Vercel, Laya (`laya-serve`, Helena's wrapper) | OpenAI-style models | any chat model |
| Status | the wire Helena already speaks (browser-task.md §2.2, `@typesafe-ai/sdk` 0.6.0) | "may change in patch releases" | one-offs, no probabilities |

**Decision:** System One is Helena's one decision shape. Every backend answers System One
questions, whatever it speaks underneath (§3.2). Helena's own interface on top
(`@helena/sdk` `DecisionQuestion`: `choice` with option ids and labels, or `yesno`) maps 1:1 onto
it (`@helena/decisions` `toSystemOne`/`readAnswer`). Confidence is TypeSafe's measure
((n·p_max − 1)/(n − 1)); every answer is checked (only offered options, probabilities
normalized, missing options 0) before a caller sees it.

### 2.2 Local backends

| | Laya `laya-typed-decisions` | Laya `laya-multilingual` | SemIf-OpenJev (Python) | **logit readout over HTTP (chosen)** | JSON answer |
|---|---|---|---|---|---|
| License | Apache-2.0 (code + weights) | Apache-2.0 | MIT | own code; llama.cpp MIT, Lemonade Apache-2.0, Qwen3.5 Apache-2.0 | – |
| Model | ModernBERT-large 421M, English only | mmBERT 322M, uncalibrated | Qwen3.5-4B (recommended) | Qwen3.5-4B Q4_K_M (bartowski @ 4168f45a, 3.0 GB) on llama.cpp/Lemonade | any chat model |
| Published quality | typed decisions 0.766 (vs Jev 0.727, Laya's own benchmark) | 0.342 zero-shot (≈ chance) | 0.845 agreement with Jev (0.883) on 102 rows, BF16 | as SemIf (same readout); measured §8 | stated confidence, not calibrated |
| Runtime | PyTorch CPU (installed for the browser checkpoint) | same | llama-cpp-python / Transformers — a second Python stack | the local AI's own server (Lemonade on the GPU), no new process | same server |
| Verdict | served next to the browser checkpoint (`install.sh typed-decisions`), measured; weak on German (§8) | rejected: needs fine-tuning | rejected as a runtime; its method adopted | **chosen** as the local backend | fallback |

**How the readout works** (`packages/decisions/src/openai.ts`, SemIf's idea, own code and
wording): the options are lettered A–T in a JSON user message
(`{evidence, question, options:[{letter, option}]}`), the model is asked for one token, and
llama.cpp returns the probabilities of that token *after* its sampler chain
(`post_sampling_probs: true`). `logit_bias` +100 on every letter makes those exactly the softmax
over the letters' logits (a grammar would not change the reported numbers: llama.cpp samples
before it applies one). `top_k: 0, top_p: 1, min_p: 0` so no letter is cut, `max_tokens: 1`,
thinking off through `chat_template_kwargs` (never Lemonade's top-level `enable_thinking`, which it
turns into a "/no_think" prefix). More than 20 options: interleaved chunks of ≤20, then the chunk
winners against each other, p(option) = p_final(winner) · p_chunk(option). A server with only
OpenAI's `top_logprobs` works too (renormalized over the letters). `debias` asks twice with the
options reversed and averages (SemIf reported answers flipping on 10 of 36 cases when the order was
reversed). Lemonade passes the body through to llama-server; the local AI branch verified
logprobs there on b11166.

**Rejected:** Laya multilingual (chance level zero-shot), SemIf's Python server (a second ML
stack beside Laya's; its HTTP path is exactly what we do), grammar-constrained sampling to read
probabilities (reports pre-grammar numbers), the agent's own subscription model as a fallback in
the API (the runtimes live in the runners; a decision must not start a run).

### 2.3 Receipt matching building blocks

Research in §7.4. Chosen: own CAMT/CSV/e-invoice parsers on `fast-xml-parser` (MIT) and
`fflate` (MIT, both directions of ZIP), poppler's `pdfdetach` (already installed with
poppler-utils) for embedded e-invoice XML, `extractText` (pdftotext/tesseract) for the rest.
Rejected: every npm CAMT package (tiny, new, a native dependency or no licence file), pdf.js for
attachments (a large dependency where poppler is there), `@e-invoice-eu/core` (WTFPL),
`factur-x-kit` (CII only), EUPL/GPL invoice libraries.

## 3. The decisions service

### 3.1 Extension points (framework, §3a)

- `@helena/sdk` **`decisionClasses`** registry (`packages/sdk/src/decisions.ts`): a class names
  its privacy (`input.store`: never | optional; `input.cloud`: allowed | never), its defaults
  (threshold, failsafe) and its eval set (`DecisionEvalSet`: labelled cases, `minPrecision`,
  `minCoverage`). Helena's classes are the internal plugin `helena.decisions`
  (`apps/api/src/modules/decisions/classes.ts`); a plugin registers its own the same way.
- `decisionBackends` gains `protocol` (`systemone` | `openai-logprobs` | `openai-json`) and the
  preset `keySource: 'local-ai'` + `modelServer` (address and key from a model server of the local
  AI). Two new built-in kinds: `local-logit` and `llm-json` (presets "Lokale KI auf diesem
  Server"). The browser task can use them too: `askSystemOne` dispatches on the protocol.
- `@helena/decisions` (`packages/decisions`): System One mapping and checks, the logit and JSON
  adapters, the eval harness (`runDecisionEval`). Pure, tested (10 tests).
- The workflow engine's step registry: built-in type `decision` (§6).

### 3.2 `decide()` (`apps/api/src/modules/decisions/service.ts`)

1. The class and the team's setting (`helena_decision_class_setting`). Off → `status: 'off'`,
   nothing asked, nothing logged.
2. The connection, then the fallback connection. Refused without asking: a connection of another
   team, a cloud connection for a class whose input must stay local (`connectionIsLocal`: a cloud
   backend or a non-private address counts as cloud), or what the **local AI gate** says (§10).
3. One System One request under the failsafe (`Promise.race` with a timer that answers first and
   then aborts the request). The fallback only gets the time that is left.
4. Every answer checked; a question is `decided` when its confidence reaches the threshold.
5. One row per question in `helena_decision`: class, subject (`run:12`, `chat:34`, `mail:56`,
   `receipt:7`, `workflow:<run>:<step>`, `claude-code:<session>`), choice, probabilities,
   confidence, threshold, status, backend, model, latency, tokens and cost (on the first row of a
   request), the input's SHA-256, and the input text **only** where the class allows it and the
   owner switched "Eingaben behalten" on. Failures are logged too (status timeout/error/no_backend).
6. An agent's decision goes into `agent_usage` (kind `tool`, runtime `decisions`, provider as the
   backend names it; local costs 0).
7. The right answer later: `recordOutcome` (the owner's correction in the log, the mail
   classifier's correction, the receipt the owner confirmed).

### 3.3 Settings, evals, the gate

- Routes (team owners/managers): `GET/PATCH /teams/:teamId/decisions/classes[/:classId]`,
  `POST …/classes/:classId/evals` (background, `helena_decision_eval`), `GET/DELETE
  /teams/:teamId/decisions/evals`, `GET /teams/:teamId/decisions/log`,
  `POST …/log/:id/outcome`.
- **A class can be switched on only when the newest finished eval on the chosen connection passed
  at the same or a lower threshold** (409 `no_eval` / `eval_failed` / `eval_threshold`). Changing
  the connection or lowering the threshold below the eval's switches the class off instead of
  failing the change. The same rule as local AI's task classes.
- Home → Entscheidungen (`apps/web/src/features/decisions`): tabs Arten · Modellwahl · Protokoll;
  per class connection, fallback, threshold, time limit, input storage, the class's own options,
  "Auswerten" with precision, coverage, accuracy, latency, tokens, cost, per question and a
  threshold sweep, and the switch with the reason it cannot be moved.

## 4. Use case 1: the model router

### 4.1 Helena's agents (`apps/api/src/modules/model-router`)

- **When:** at the claim of a fresh run without a model of its own (not a resumed session, not a
  digest or workspace job), and of a chat answer whose thread follows the agent's model (a model
  the owner picked for a thread is never routed). The decision is stored on the run
  (`agent_run.model`), so a resumed session keeps it and the model check compares against it.
- **Questions** (`questions.ts`, class `helena.model-router`): `route` — the cheapest tier that
  handles the request well, on a fixed scale light < standard < strong < strongest with our own
  descriptions; `needs_context` — does it depend on the earlier conversation or work.
- **Tiers of the models** (`tiers.ts`): from the agent's runtime catalog (the models its runner
  published, minus those the provider refused: model-availability), same provider as the
  configured model, with a price from the price table (autopilot). Named families first (Claude
  haiku/sonnet/opus/fable; `mini`/`nano`/`flash`/`lite` = light), else the price rank counted from
  the cheapest (light, standard, …) — with two models (gpt-6-luna < gpt-6-sol) only light requests
  move down.
- **Rule:** route only when `route` is decided (≥ class threshold), P(needs context) is below the
  class option "Bleiben, wenn Kontext nötig ist" (default 0.5), and a cheaper model covers the
  tier. Never above the configured model; with "Auch stärker" (per agent, off) at most one tier up.
  The reasoning level follows where the target model has it, else its default.
- **Switches:** per agent (off by default), per project (on unless switched off), and the class
  itself (eval). `helena_model_router_setting`, `helena_model_route` (from → to, tier, confidence,
  P(context), reason: cheaper_tier, upgrade, same_tier, needs_context, unsure, no_candidates,
  timeout, error, no_backend).
- **Visible:** run view ("Modellwahl: gpt-6-sol → gpt-6-luna · ein günstigeres Modell reicht
  (82 %)"), a badge in the runs list, a line under a routed chat answer, and Home → Entscheidungen
  → Modellwahl (switches + latest decisions).

### 4.2 The owner's Claude Code (`deployment/volition-stack/native/claude-code-router`)

The video's companion repository (AlexPEClub/Jev-Model-Router-Claude-Code) has **no licence**, so
nothing of it is copied; the behaviour was re-implemented from its description and Claude Code's
hook documentation.

- `route.py` — the `UserPromptSubmit` hook (Python stdlib). Reads only `prompt` (and the session
  id to find the session's model), skips slash commands and prompts under 12 characters, posts to
  Helena `POST /model-router/prompt` with the owner's API key (`x-api-key`, file `key`, 0600,
  written by the owner), 5 s failsafe, fails open (exit 0, no output), logs one JSON line per
  decision (no prompt text unless `logPrompt`). Helena answers with a **factual** note (Claude
  Code's hook guidance: imperative context can trip prompt-injection defences); the standing rule
  what to do with it goes into `~/.claude/CLAUDE.md` (installer option `--claude-md`).
- `session.py` — SessionStart/PostModelSwitch hooks remember each session's model (the prompt
  hook has no model field; the video's version hard-codes it).
- `router.py` + skill `/router on|off|status|test|log` (German output).
- `install.sh install|status|uninstall [--purge]` (as the owner): merges the hooks into
  `~/.claude/settings.json` with a backup, idempotent, never switches it on, never writes a key.
- Differences to the video: Helena's decision service (any backend, eval-gated, logged) instead
  of a direct TypeSafe call; missing `needs_context` counts as "depends" (the video's default 0
  biased towards delegating); session model tracked; the HTTP status checked; note factual.
- Tests: `tests/test_router.py` (7: off, on with only the prompt sent, skips, fail-open, quiet,
  session model, installer merge + uninstall restore).

## 5. Use case 2: mail classification (`apps/api/src/modules/mail-triage`)

- **Questions** (class `helena.mail`): `project` (the team's projects with their descriptions, or
  none), `category` (invoice, appointment, request, newsletter, notification, personal,
  advertising, other), `priority` (high, normal, low), `needs_reply`, `create_task`. One request per
  mail (sender, subject, attachment names, the first 3,000 characters of the text).
- **When:** the engine system job `helena.mail-triage` (every minute while a team has the class
  on) classifies new inbox mail that arrived after the class was first configured, at most 20 per
  team and tick, not the account's own sent mail; "Einordnen" on a thread classifies it now.
- **Actions** (class options, all off or a suggestion by default — a suggestion is a button the
  owner presses, which is the approval): project `off | suggest | auto` (auto moves only Home mail;
  a thread in a project is only suggested), task `off | suggest | auto` (a task in the thread's
  project, linked to the mail), hand to an agent `off | suggest | auto` (that task assigned to the
  chosen agent, if it works in the project), invoices as receipts `off | auto` (§7). Automatic
  actions run as the owner who configured the class. Nothing acts on an answer below the
  threshold.
- **In the inbox:** badges in the list (kind, urgent, needs reply), a card in the thread with the
  answers (unsure ones marked), corrections (kind, priority, reply) that go to the decision log,
  and the suggested task / hand-over as buttons. `helena_mail_classification` keeps the result and
  what was done.
- The old hub-inbox triage (an external integration service, off since Mastra left) is not used.

## 6. Agents and workflows

- **MCP tool `decide`** (`POST /decisions/decide`, category `read`, read-only annotation): an
  agent (or a person) asks one question with 2–50 options, or yes/no, about a context; class
  `helena.general`. The answer says `decided` or `unsure`; the tool description tells the agent to
  act only on `decided`. The run is taken from `x-helena-run` (D-C7) for usage.
- **Workflow step "Entscheidung"** (engine built-in type `decision`, branching): question and
  context are templates (`{{task.*}}`, `{{step.<id>.*}}`), 2–12 options, the options that lead into
  the first lane, and where "unsure" goes (second lane, first lane, or stop the run). A later step
  can reuse an earlier decision step's answer (no second question), so several lanes follow one
  question. The chosen option is the step's `outcome` and `summary`; a following condition can
  test it by keyword. Builder: the form, the lanes labelled with the options.

## 7. Use case 3: receipt matching v1

### 7.1 Sources

- **Bank transactions:** file import per bank account — CAMT.053/052/054 in `.001.02` and
  `.001.08` (German banks deliver only `.08` over EBICS since November 2025; online exports still
  offer both), ZIPs of several statements (with limits against zip bombs), and the CSV exports of
  Sparkasse (CSV-CAMT and CSV-MT940), DKB, ING, N26, Commerzbank, Deutsche Bank/Postbank and
  VR/Atruvia, detected by header synonyms (`packages/finance`). SEPA tags in the purpose
  (EREF/MREF/CRED/SVWZ, VR style) are read. Pending entries are skipped; re-imports dedupe.
- **Receipts:** mail attachments (the mail classifier's "Rechnungen als Belege", or by hand),
  uploads (stored in `Projects/<KEY>/Files/Belege/<YYYY-MM>/`), and files already in the vault.
  E-invoices first: the embedded XML of ZUGFeRD/Factur-X PDFs (`pdfdetach`) or a plain XRechnung,
  CII and UBL (EN 16931 fields: number, dates, seller, VAT id, IBAN, payment reference, mandate,
  net/VAT/gross/due, Skonto terms). Since 2025 German businesses must accept e-invoices, and the
  XML is the legally leading part. Otherwise text (pdftotext/OCR) and German/English heuristics.

### 7.2 Matching

1. Rules (`rankCandidates`): direction (bills pair with payments out, own invoices with payments
   in), amount on the amount due else gross (exact ≤2 ct; Skonto only when lower; fees on credits;
   ±3 % weak), date windows by payment kind (transfer −5…+45 days, direct debit around the due
   date, own invoices 0…+60; never outside −90…+120/180), reference (the invoice number or the
   payment reference in the purpose/end-to-end id), identity (IBAN, creditor id/mandate, name
   similarity after dropping legal forms; payment intermediaries like PayPal matched by the
   merchant in the purpose).
2. `autoMatch`: exact amount, primary window, a reference or identity signal, and a clear margin to
   the second candidate → matched by rule.
3. Otherwise the decision model (class `helena.receipts`) picks among the top ≤6 candidates or
   "none". Decided and agreeing with the rules' top (or an exact amount) → matched; otherwise a
   proposal in **Prüfen**; a decided "none" leaves the receipt open.
4. The owner confirms or rejects proposals, or picks a transaction by hand; the decision log gets
   the outcome.

### 7.3 Output

Project page **Belege** (owners/admins): Offen (receipts without a transaction, transactions
without a receipt, "kein Beleg nötig"), Prüfen, Zugeordnet, Konten (accounts and imports). Export
per month: `Buchungen_<YYYY-MM>.csv` (`;`, UTF-8 BOM, decimal comma) and a ZIP with the receipts
under Ausgaben/Einnahmen/Belege-ohne-Zahlung, e-invoice XML next to its PDF. DATEV's "Buchungsstapel"
needs Kontierung and is not v1; DATEV's XML document package is the v2 target.

### 7.4 Later feeds (researched, not built)

- **The owner's ERPNext** (only if it already receives bank data): `GET /api/resource/Bank
  Transaction` with a token from Zugänge, dedupe on `transaction_id`. ERPNext's own German bank
  sync (alyf-de/banking) needs a paid subscription. *The owner's `m5-control` project README has
  not been read yet (Kingston was being rebooted); to be added.*
- **Enable Banking** (restricted production mode: the owner links his own accounts, no contract,
  consent up to 180 days; each installation registers its own app). Best PSD2 option for a
  self-hoster. GoCardless Bank Account Data closed new sign-ups in July 2025; finAPI, Tink, Yapily,
  TrueLayer, Salt Edge are contract-gated.
- **FinTS/HBCI** directly: needs a product registration with the Deutsche Kreditwirtschaft (free,
  one per product); the maintained library `lib-fints` is LGPL-2.1+ (outside Helena's licence list:
  only as a separate optional plugin with an explicit exception); SCA per session or every
  90/180 days.
- **EBICS** for business accounts (C53 camt ZIPs), `node-ebics-client` (MIT).
- Order: file import (v1) → ERPNext pull → Enable Banking → FinTS plugin → EBICS.

## 8. Evals

**Harness:** `runDecisionEval` scores by code, never by a model: precision of the answers above
the threshold, coverage (share above it), accuracy overall, p50/p95 latency, tokens, cost, per
question and a threshold sweep. In Helena ("Auswerten") and from the command line
(`apps/api/src/scripts/decisions-eval.ts`, any backend without a database).

**Sets** (German, fictional; `apps/api/src/modules/decisions/evals/`, checked by `evals.test.ts`):

| Set | Cases | Questions | Pass rule |
|---|---|---|---|
| router | 40 (10 light, 12 standard, 10 strong, 8 strongest; 12 depend on context; 20 % English) | route, needs_context | precision ≥ 0.85, coverage ≥ 0.5 |
| mail | 40 over 5 fictional projects mirroring PRIV/FAM/VOL/VERVE/Helena, every kind ≥ 3× | project, category, priority, needs_reply, create_task | 0.85 / 0.5 |
| receipts | 25 (18 with a match, 7 without; Skonto, PayPal, direct debit, own invoices, near amounts) | match | 0.9 / 0.4 |
| general | 24 (sentiment, team, deadline, meeting reply, review, label, language, intent, complaint) | 9 kinds | 0.85 / 0.5 |

**Numbers so far** (Kingston, 2026-09-25 ~00:30, **CPU only**, while the RAID resynced; the run was
stopped early on the orchestrator's request because the host was overloaded; the GPU run with
`-ngl 99` is pending):

| Backend | Set | Accuracy | Precision @ threshold | Coverage | p50 / p95 per case |
|---|---|---|---|---|---|
| Laya typed-decisions (CPU, 8 threads) | router | 60 % (route 43 %, context 78 %) | 100 % (1 answer) | 1 % | 1.2 / 1.4 s |
| | mail | 52 % (project 60, kind 45, priority 45, reply 48, task 60) | 100 % (2 answers) | 1 % | 5.1 / 5.6 s |
| | receipts | 52 % | – | 0 % | 0.9 / 1.1 s |
| | general | 59 % | – | 0 % | 0.36 / 0.55 s |
| Qwen3.5-4B Q4_K_M, logit readout (CPU, 12 threads) | general | **96 %** | **100 %** | **96 %** → passes | 1.8 / 3.6 s |
| | router | 74 % (route 57 %, **context 90 %**) | 100 % | 39 % → fails coverage | 4.7 / 5.1 s |
| Qwen3.5-4B, logit, debiased (both orders) | general | 100 % | 100 % | 93 % → passes | 2.0 / 4.3 s |
| Qwen3.5-4B, JSON answer | general | 96 % | 96 % | 100 % → passes | 2.4 / 5.4 s |

What this means so far:

- **Laya's typed-decisions checkpoint does not suit German content**: its answers are close to
  chance on the German sets and its confidence stays low, so almost nothing would be decided — a
  class on it simply falls back to the default (safe, but useless). It stays useful for the
  browser (its browser checkpoint) and for English content.
- **The logit readout of a 4B decoder is the strongest local backend**: near-perfect on general
  typed questions, very good at "depends on context", weak at rating difficulty (the tier scale is
  judgement, not reading). The router class would therefore mostly keep the configured model —
  the safe direction.
- On the CPU a request with several questions takes seconds; the router's 5 s failsafe would often
  cut it. The GPU (Lemonade/llama.cpp, the local AI) is the intended place; the numbers above are
  an upper bound for latency.
- Jev Cloud numbers need the owner's key; the same harness runs them
  (`--backends '[{"name":"jev","protocol":"systemone","url":"https://api.typesafe.ai","keyFile":"…","model":"jev-latest"}]'`).

## 9. Safety

### 9.1 Fixes found live (commit a4e3899f)

- **Read mode never changes the page.** `browser_task` with `mode: read` offered links, tabs and
  expanders as "read-safe" clicks, which are `write` for the policy; with the goal "nichts
  anklicken" Laya clicked twice. Now read mode offers no click at all, the loop stops with
  `denied` before any operation above `read`, and the gateway runs read tasks on
  `readOnlyPage`, which refuses everything but scrolling and waiting whatever a policy or model
  proposes. Tests in `loop.test.ts`; the navigation evals moved to mode `act`, a new
  `local-read-only` eval checks the page stays. jev-browser refuses read mode (it has none).
- **jev-browser's Chromium in the router unit ("chromium trap int3").** Reproduced in a transient
  unit with the router's sandbox: Chromium keeps crashpad's database under `$HOME`/XDG, which is
  read-only under `ProtectSystem=strict` → "chrome_crashpad_handler: --database is required" →
  SIGTRAP. Fix: HOME/XDG point into the throwaway profile (writable TMPDIR). **No sandbox setting
  was loosened** (Chromium's own sandbox stays on and works inside the unit). The router keeps the
  child's stderr tail for the run summary.
- `laya/install.sh`: the key's group is the API's secrets group (`volition-plan-secrets`;
  `helena-secrets` after the rename), detected, `HELENA_API_GROUP` still overrides.

### 9.2 Privacy

- A cloud backend (Jev, Vercel) receives the question and its context; Zugänge says so, and a
  class may forbid it (`input.cloud: 'never'`). Laya and the local AI keep it on the machine.
- The decision log keeps the input only when the class allows it and the owner switched it on;
  otherwise a SHA-256. The Claude Code hook sends only the prompt text and logs no text by default.
- Keys never leave the API; `keySource: 'local-ai'` reads the local AI's key through its resolver.

## 10. Other branches and merge notes

| Branch | What connects | Done here | To do at merge |
|---|---|---|---|
| hub/local-ai | Lemonade + model servers; the "Lokale KI" policy | `useModelServerResolver` (connection.ts) and `useDecisionGate` (decisions/service.ts) as hooks; `local-logit`/`llm-json` presets point at `http://127.0.0.1:13305/api/v1` (local-ai's convention; a doubled `/v1` is avoided) with `keySource: 'local-ai'` | register the resolver in `helena.local-ai` (below), the gate only if the owner wants the master switch to cover decisions (§11.7) |
| hub/browser-task (merged) | decision backends, System One client, Laya | `protocol` dispatch in `askSystemOne`; Laya serves several checkpoints (`HELENA_LAYA_MODELS`) | – |
| hub/native-engine (merged) | step registry, system jobs | step `decision`, job `helena.mail-triage` | – |
| hub/mail (merged) | mail model | classification table, list badges, `createTaskFromThread(…, {assigneeUserId})` | – |
| hub/autopilot, hub/model-availability | price table, refused models | read by the router's tiers | – |

Local AI registration (to add in hub/local-ai's plugin once both are merged; names as on
hub/local-ai be4bbf69):

```ts
import { modelServerBySlug, readLocalAiPolicy, readModelServerKey } from '@repo/db';
import { useModelServerResolver } from '#modules/browser-task/connection';
import { useDecisionGate } from '#modules/decisions/service';

useModelServerResolver(async (slug) => {
  const server = await modelServerBySlug(slug);
  return server ? { baseUrl: server.baseUrl, key: await readModelServerKey(server) } : null;
});
// Only if the owner wants the "Lokale KI" master switch to cover decisions too (§11): a class
// the owner pointed at a local connection is otherwise his explicit choice, not local AI acting
// on its own.
useDecisionGate(async ({ local }) =>
  local && !(await readLocalAiPolicy()).enabled ? 'Lokale KI ist ausgeschaltet' : null,
);
```

## 11. Open owner decisions

1. Which backend answers each class once the GPU evals are in (recommendation: the local logit
   backend on Lemonade for mail, receipts and general; router only if its GPU eval passes).
2. Jev Cloud: a key from console.typesafe.ai (sign-ups paused) or the Vercel AI Gateway — then the
   same evals decide.
3. Installing the Claude Code router hook in the owner terminal (`install.sh install --claude-md`,
   then an API key and `/router on`).
4. Installing the typed-decisions checkpoint next to the browser one (`laya/install.sh
   typed-decisions`, 842 MB, memory limit 6 GB) — not recommended for German content (§8).
5. Mail: which actions to allow automatically; receipts from invoice mail automatically.
6. Receipts: which projects get bank accounts; later ERPNext pull or Enable Banking (§7.4).
7. Whether the local AI master switch also covers decision classes pointed at a local connection
   (§10; recommendation: no, the class switch is already the owner's explicit choice).

## 12. Sources

- TypeSafe docs: https://docs.typesafe.ai/llms.txt, /api.md, /confidence.md, /models.md,
  /patterns/confidence-routing.md, /model-jaggedness/jev-1.13.md
- https://www.alexsprogis.de/ressourcen/jev-model-router-claude-code;
  https://github.com/AlexPEClub/Jev-Model-Router-Claude-Code (no licence: behaviour only);
  https://github.com/gargpratyush/jev-router (MIT, proxy alternative, skimmed)
- Claude Code docs: https://code.claude.com/docs/en/hooks.md, /sub-agents.md, /skills.md
- https://github.com/TheoLeeCJ/SemIf-OpenJev @ 23cf1f39 (core.py, llamacpp_backend.py,
  webgpu-demo/worker.js, results/phase1-summary.json)
- llama.cpp `tools/server/README.md`, `server-common.cpp`, `common/sampling.cpp` @ 84e76d8a;
  Lemonade `docs/api/openai.md`, `thinking_controls.cpp`, llama.cpp backend @ 6deeb05f
- Hugging Face: convaiinnovations/laya-typed-decisions @ 1a793eb5, laya-multilingual @ e4e9ddf2,
  bartowski/Qwen_Qwen3.5-4B-GGUF @ 4168f45a; https://github.com/NandhaKishorM/laya @ 970dc8c5
- Bank formats: Sparkasse and VR format announcements (MT940/camt .02 switch-off), genkgo/camt,
  Firefly III import configurations, bank2ynab; ISO 20022 camt.053 paths (validatefin)
- E-invoices: BMF letter of 15.10.2025 (Baker Tilly summary), DATEV legal overview, EN 16931 CII/UBL
- Feeds: fints.org product registration FAQ, EU 2022/2360, Enable Banking docs, GoCardless sign-up
  notice, finAPI prices, alyf-de/banking, ERPNext Bank Transaction doctype
- Matching: ERPNext bank reconciliation tool, Lexware "Zuordnungsvorschläge", sevDesk, Odoo 18
  reconciliation models, GnuCash, beancount smart_importer
