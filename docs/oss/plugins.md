<!-- Stub (package G). The plugin guide itself is written by hub/framework in
     docs/helena-framework.md; this page is its public entry point. -->

# Extending Helena with plugins

Helena is built as a framework. Every capability sits at an **extension point**, and
Helena's own features use the same interfaces as a third-party plugin. You can therefore add
a runtime, a connector, an agent tool or a workflow step without touching the core.

**The full guide:** [`docs/helena-framework.md`](../helena-framework.md) (SDK, registries, event
bus, manifest, loading, an example plugin). It is written together with `@helena/sdk`.

## At a glance

A plugin is a package with a manifest, `helena.plugin.json`:

```json
{
  "id": "example.weather",
  "version": "0.1.0",
  "engines": { "helena": "^1.0.0" },
  "provides": {
    "tools": ["./dist/tools.js"],
    "workflowSteps": ["./dist/steps.js"],
    "uiSlots": ["./dist/ui.js"]
  },
  "permissions": ["network:api.weather.example"]
}
```

(The field names are illustrative; the SDK's JSON Schema is the reference.)

| Extension point | You provide |
|---|---|
| Runtime | Profile writer, start and resume, chat stream, sessions, memory, usage, capabilities |
| Connector | Sign-in flow, credential schema, services, grants, tools, health |
| Agent tool (MCP) | Tools with description, input schema and **action category** (read, write, send, delete, pay, publish) |
| Workflow step / trigger | Step types and triggers for the workflow builder |
| Policy | Rules for the central "may this agent do this here" decision |
| Event handler | Subscriptions to domain events |
| UI slot | Tool panel tools, settings sections, agent tabs, dashboard widgets, header actions |
| Template pack | Agent templates, skills, project and workflow templates |
| Language / theme | Translation files, colour tokens |

Plugins are loaded at start. A plugin's permissions are shown to the admin before it is
enabled.
