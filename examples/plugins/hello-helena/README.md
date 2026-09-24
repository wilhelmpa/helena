# Hello Helena

The example plugin of [docs/helena-framework.md](../../../docs/helena-framework.md): a
connector with a tool, a tool of its own, a workflow step type, a panel tool and an event
subscription, added to Helena without changing Helena.

Try it:

1. Point Helena at the example folder: `HELENA_PLUGINS_DIR=<repo>/examples/plugins` for the
   API and the worker.
2. Administrator → Plugins: switch external plugins on, approve "Hello Helena".
3. Restart the API and the worker.

Then `hello_time` is in every agent's MCP tools, "Hello Greeter" is in the integrations
catalog, and the panel has a "Hello" tool.
