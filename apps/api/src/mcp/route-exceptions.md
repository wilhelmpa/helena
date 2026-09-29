# Routes without MCP tools

`route-exceptions.json` lists each REST route without an `x-mcp` tool as `[method, path, class]`. The route coverage test requires every route to appear exactly once as a tool or an exception. A new route fails the test until it is reviewed and explicitly classified.

- `intern`: machine, runner, webhook or internal transport endpoint.
- `binär`: file transfer or streamed payload unsuitable for the JSON tool dispatcher.
- `auth`: authentication endpoint, private session data, or a route whose agent authorization and project scope still need review. The last group is open work; the label does not mean the route is safe to expose.
- `admin`: instance or administrative control plane, including receipt routes guarded by `projectAdmin` without a declared `x-permission`.
- `UI-only`: view state, picker, preview or chat interface endpoint.

The `auth` entries with `x-permission` are the current review queue. Before converting one to a tool, check its successful response is JSON, inspect all additional handler checks, and verify that an agent key cannot cross project boundaries. Remove the exception when the tool is added.
