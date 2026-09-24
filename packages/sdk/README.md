# @helena/sdk

The extension contracts of Helena: typed interfaces, a small registry core, the plugin
manifest (`helena.plugin.json`) with its JSON Schema, the plugin host and loader, and the
CloudEvents envelope of Helena's domain events. How it fits together, every extension
point with an example, and how to write a plugin: [docs/helena-framework.md](../../docs/helena-framework.md).

Entries:

| Import | What | Runs in |
|---|---|---|
| `@helena/sdk` | contracts, `Registry`, action categories, events, policy, runtime and knowledge types | everywhere (no runtime dependencies) |
| `@helena/sdk/server` | `PluginHost`, manifest checks, the plugin loader, the outbox helper | API, worker, runner (Node/Bun) |
| `@helena/sdk/bundles` | the directory form of template bundles | Bun |
| `@helena/sdk/web` | the UI slot registry and slot types | the web app |
| `@helena/sdk/plugin.schema.json`, `@helena/sdk/bundle.schema.json` | JSON Schemas | editors, validators |

A plugin imports only **types** from `@helena/sdk`; zod, the event bus and a logger come
in the context Helena hands its `register(ctx)`.

## Licence

`@helena/sdk` is licensed under the **Apache License 2.0** (see [LICENSE](LICENSE)), inside
the AGPL-3.0 Helena monorepo (owner decision, 2026-09-24). The contracts in this package —
the types a plugin imports and the plugin API it is called through — are Apache-2.0, so a
plugin may carry any licence, including a proprietary one. Helena itself, the host that
loads plugins (API, worker, runner, web), stays AGPL-3.0. Contributions to Helena,
including this package, go through the project's CLA.
