# Routes without MCP tools

`route-exceptions.json` lists each REST route without a tool as `[method, path, class, reason]`. `route-tool-catalog.json` adds explicit tools for existing guarded routes without changing their HTTP handlers. The route coverage test requires every route to appear exactly once as a tool or a reasoned exception. A new route fails the test until it is reviewed.

- `intern`: machine, runner, webhook or internal transport endpoint.
- `binär`: file transfer or streamed payload unsuitable for the JSON tool dispatcher.
- `auth`: sign-in, session, OAuth callback or interactive account linking.
- `admin`: instance or credential control plane, including `/god` routes excluded by Auftrag 118b.
- `UI-only`: personal browser state, picker or public share view.

Catalog tools dispatch to the original route with the caller's key. The route's authentication, team and project guards continue to enforce access. A catalog entry carries an action category and gets its input and output schemas from the route.
