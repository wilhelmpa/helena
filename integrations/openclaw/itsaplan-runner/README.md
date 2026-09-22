# Its-a-Plan Runner

Host-local OpenClaw plugin for external Its-a-Plan agents.

The runner:

- claims queued issue runs with each Plan agent's own API key;
- routes every Plan identity to one fixed OpenClaw agent;
- runs a normal tool-capable OpenClaw session instead of tool-free inference;
- keeps one stable session per issue so follow-up runs retain context;
- drains the native Plan chat feed and keeps one resumable OpenClaw session per chat thread;
- publishes every currently available prepared-catalog model allowed by the destination agent's OpenClaw model policy, with host-resolved thinking policy per model;
- applies the selected model through `api.runtime.subagent.run` and the selected thinking level as OpenClaw's documented per-turn `/think` directive;
- forwards live OpenClaw text deltas, tool calls, and results as AG-UI events for the native Plan chat;
- resolves the exact OpenClaw task by its returned run ID and cancels it through the owner-scoped task runtime when Plan acknowledges cancellation;
- redacts tool arguments and results before forwarding them to Plan;
- posts each issue result as a threaded comment and reports run/chat completion through the Plan agent's own key, so the visible identity stays the assigned agent;
- keeps leases alive and reports failures instead of silently retrying side effects.
- allows a bounded settle grace for delegated child results and accepts only assistant text newer than the current invocation, preventing stale session output.

Routine internal work is autonomous. The OpenClaw approval policy uses automatic review
for commands that are not already known-safe. External delivery, production changes,
destructive work, purchases, access changes, and secret mutation remain explicit human
approval boundaries.

Keys belong in OpenClaw's protected Secret Store and are referenced from
`plugins.entries.itsaplan-runner.config.agents.*.apiKey`. Never put them in this
directory, an issue, a chat message, or source control.

Model overrides require host opt-in. The destination agent's `modelPolicy.allow`
remains the authoritative allowlist, so catalog additions never grant themselves:

```json5
{
  plugins: {
    entries: {
      "itsaplan-runner": {
        subagent: {
          allowModelOverride: true,
        },
      },
    },
  },
}
```

The plugin does not request operator Gateway scopes and does not use a Gateway
token. Catalog reads, agent model-policy validation, model execution, thinking
policy, and cancellation use the public OpenClaw 2026.9.5 Plugin Runtime/SDK
surfaces. The model and thinking combination is validated again immediately
before dispatch.
