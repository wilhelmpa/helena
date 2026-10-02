# Registered tool regression fixtures

`catalog.json` freezes all 831 registrations (704 API, 84 connectors, 30 browser,
13 native). Each suite compares the assembled registry with its fixture catalog;
a new registration fails the gate until its executable fixture is added.

The API suite seeds a private test database and vault with ABSCHLUSSTEST users,
teams, projects, agent, task, mail thread, receipt, note, goal and routine. It uses
`dispatchTool`, the same in-process MCP handler used by agent calls. Mutating cases
start from a fresh seed. Inputs are sampled from the actual schema, validated before
dispatch, and supplemented with fixture identities. Results must fit the declared
output schema and never contain a 5xx. Declared domain refusals (for example an absent
run or a missing provider configuration) remain 4xx and are recorded separately
from successful 2xx responses; they do not prove a successful business operation.
`api-status.json` pins each executable fixture's expected status, so a previously
successful 2xx operation changing to a 4xx also fails the gate. Its keys must cover
every executable API registration.

Connectors use real credential binding, agent authorization and `callConfiguredTool`.
Synthetic provider replies block unknown hosts before network access. Paper trading
uses the real database locks, intents, risk limits and human strategy approval;
only HTTP responses and the model precheck are mocked. Operator launcher and runtime
requests use synthetic adapters. `run_as_root` and `apply_model_schema_changes`
currently have invalid-input coverage only: their positive operator fixtures are
explicitly reported as pending. Six person-only registrations must be absent from
an actual agent MCP `tools/list` response.

Project-scoped routes reject an unrelated user and, where they accept a project or
vault selector, an agent naming another project in the same team. The knowledge
path resolver deliberately answers unreadable references with `path: null` and
must disclose no path. Global/argumentless tools have no fabricated project selector
or required input; those checks are marked not applicable in the recorded results.

Browser tools execute through `GatewayDispatcher` against fake sessions and a
synthetic browser-task backend. Native tools use `executeTool` in temporary
workspaces, with real filesystem and shell operations. Shell exit 7 stays neutral.

All suites run in the existing gate. Individual API runs can write per-tool evidence
using `VOLITION_TOOL_RESULTS` and `VOLITION_CONNECTOR_RESULTS`; optional
`VOLITION_TOOL_FILTER` narrows only diagnostic runs and must be unset for acceptance.
