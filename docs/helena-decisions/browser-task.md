# Browser task and Browser 2.0

Helena offers two ways to work in a project browser: Standard, where the agent uses step tools, and a decision connection, where `browser_task` runs a bounded observe–decide–act loop. Standard is the default. Browser 2.0 runs the same paths for comparison and stores steps, status, time, tokens and cost.

## 2. Backend protocol

### 2.2 System One client

The API uses `@typesafe-ai/sdk` to ask a System One service named by a decision connection. The browser gateway sends questions to the API and receives answers; it never receives a backend key. The API calls the service through `@repo/net`'s guarded fetch. The built-in choices are TypeSafe Jev Cloud, Jev through Vercel AI Gateway, and a configurable System One compatible server.

## 3. Browser decisions

### 3.1 Browser loop

The loop runs in `packages/browser-gateway/src/task/` and uses the project's existing browser session, control lock, domain rules and action policy. It observes the page, asks the connection for an operation and target, checks page freshness and target visibility, and applies the action only after Helena authorizes it. The loop has step and decision budgets, detects repetition, and returns a status with page evidence when an agent or owner must continue. A login is handled by the existing `browser_login` or handover path. Read mode cannot click, type, select or press Enter.

The `jev` policy in `policy-jev.ts` sends one request per round with operation and target choices, completion and error questions, and a choice over values supplied by the caller. The backend never invents text to type. `TYPE_TEXT` uses only a caller supplied value. Uncertain targets return control to the agent. The loop pauses consequential actions according to Helena's policy and its irreversible action check.

### 3.2 Agent tools

`browser_task`, `browser_check` and `browser_choose` are the agent tools for the decision path. `browser_task` accepts a goal, optional values and start URL, a read or act mode, a step limit, and an irreversible action allowance. Other browser tools and the owner's live takeover continue to use the same gateway.

### 3.3 Connections and settings

A decision backend is a `decision_model` credential under Zugänge. A local AI model server may supply its own address and key through the existing local AI connection. The TypeSafe and Vercel choices require a key. A compatible server may have a stored key, reference an API key credential, or run without a key. A private address needs the owner's explicit allowance for that connection. The API holds keys and makes the System One request; the browser gateway receives only the answer.

Project settings under Browser-Steuerung choose Standard or a decision connection, the `auto` or `jev` policy, and an optional confidence threshold. The instance default applies where a project inherits it. If a saved connection disappears, the project uses Standard. A saved policy value outside `auto` and `jev` resolves to `auto`.

### 3.4 Usage and provenance

A task result includes status, final page, steps, backend, model, token use and duration. The task run and usage ledger store the outcome and cost without a backend secret. Browser 2.0 displays these measures for each run.

### 3.5 Browser 2.0

Home and project Browser 2.0 offer a task form, live view, run history and comparison. A decision run uses the selected agent's policy and browser lock. Standard sends the goal to the agent, which uses the step tools. The separate `jev-browser` comparison runs in a throwaway browser with an empty profile; it does not attach to the project browser. Its backend request is proxied through Helena with a short lived run token, so the backend key remains in the API.

### 3.6 Security

The configured decision service receives redacted page state, which can contain visible page text. Password and one time code values are never read into that state. The session's `SecretGuard` also filters information leaving the gateway. Cloud connections send this state to their provider. Private address requests require the connection's explicit host allowance and remain pinned against DNS rebinding. No page receives a backend key.

### 3.7 Evaluation

The evaluation harness in `packages/browser-gateway/eval/` can run fixture and public tasks with the mock backend or a configured Jev connection. Mock results verify the harness and loop shape; provider quality requires a provider run. The browser loop tests cover read mode, target confidence, completion, locks and handback.
