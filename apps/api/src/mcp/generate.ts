import {
  annotationsForCategory,
  categoryFromAnnotations,
  type ActionCategory,
  type ActionScope,
} from '@helena/sdk';
import { CompactThreadPage } from '#modules/mail/threads/compact';
import type { DeclaredPermission } from '#shared/guards';
import type { McpApp } from './types';
import routeToolCatalog from './route-tool-catalog.json';
import { outputSchema, type McpOutputSchema } from './result';

// Turns the assembled app's routes into MCP tool descriptors. A route opts in by
// carrying an `x-mcp` extension in its OpenAPI `detail` (see mcpTool). The route's
// own TypeBox schemas and permission guard stay the single source of truth: the
// generated tool only forwards a call to the route through app.handle (dispatch.ts),
// so validation, permissions, and the error model are reused, never duplicated.

// The JSON Schema an MCP client receives for a tool's arguments. TypeBox emits
// JSON Schema, so the route schemas are merged into this shape as-is.
export interface McpInputSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required: string[];
}

// Behaviour hints an MCP client reads to decide what a tool may do — chiefly
// whether a call needs the user's confirmation before it runs. Hints, not
// guarantees: the route's guard is still what actually enforces anything.
export interface McpToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface McpRouteTool {
  name: string;
  // The display name a client shows (MCP tool `title`): the route's OpenAPI summary.
  title: string;
  description: string;
  method: string;
  // The route path template, e.g. "/projects/:projectKey/issues".
  path: string;
  // Path param names parsed from the template, e.g. ["projectKey"].
  pathParams: string[];
  // Whether the route declares a body schema. The method alone does not say: a
  // DELETE carries one where the deletion needs an argument.
  hasBody: boolean;
  inputSchema: McpInputSchema;
  outputSchema: McpOutputSchema;
  annotations: McpToolAnnotations;
  // What calling it does (@helena/sdk action category): declared on the route, or what
  // its annotations imply (GET reads, DELETE deletes, the rest writes).
  category: ActionCategory;
  // Where a delete or execute lands for Helena's Autopilot: inside the agent's workspace
  // (Helena's own data of the project, the default) or outside it (a whole project, an
  // agent, the internet).
  scope?: ActionScope;
  // The cell of the role matrix the route's guard asserts, published by the guard as
  // `x-permission` on the route's detail. Absent on a route that asks only for
  // project membership.
  permission?: DeclaredPermission;
  access?:
    | 'team-manager'
    | 'team-owner'
    | 'decision-reader'
    | 'agent-inspector'
    | 'person-only'
    | 'project-owner'
    | 'root-owner';
  // The connector whose accounts the tool acts with. The tool is listed only to an
  // agent that holds a grant on one of them.
  connector?: string;
}

// Marks a route as an MCP tool. Spread into a route's `detail`:
//
//   detail: { summary: "Create an issue", ...mcpTool("create_issue") }
//
// The HTTP method already states how a route behaves, so it supplies the
// annotations by default (see methodAnnotations). Pass the second argument only
// where the method understates it — a POST that revokes a credential or turns
// down an invite is destructive even though POST as a class is not:
//
//   detail: { ...mcpTool("regenerate_ai_agent_key", { destructiveHint: true }) }
//
// `x-mcp` is an OpenAPI extension key, so it rides along in the route's detail,
// is read back from app.routes by generateRouteTools, and does not show up as a
// real field in the REST/OpenAPI docs.
//
// The third argument is the action category where the annotations understate it: a POST
// that starts an agent run executes, one that mails an invite sends.
//
// The fourth argument says where the action lands, for Helena's Autopilot, when it reaches
// outside the agent's workspace: deleting a whole project, mailing someone. The fifth names
// the connector whose accounts the tool acts with (see McpRouteTool.connector).
export function mcpTool(
  tool: string,
  annotations?: McpToolAnnotations,
  category?: ActionCategory,
  scope?: ActionScope,
  connector?: string,
): {
  'x-mcp': {
    tool: string;
    annotations?: McpToolAnnotations;
    category?: ActionCategory;
    scope?: ActionScope;
    connector?: string;
  };
} {
  return {
    'x-mcp': {
      tool,
      annotations,
      ...(category ? { category } : {}),
      ...(scope && { scope }),
      ...(connector ? { connector } : {}),
    },
  };
}

// What the HTTP method alone says about a route. A GET only reads; a DELETE
// removes and repeats harmlessly; PUT/PATCH replace in place, so repeating one
// lands on the same state; POST creates, so it does not.
function methodAnnotations(method: string): McpToolAnnotations {
  switch (method.toUpperCase()) {
    case 'GET':
      return { readOnlyHint: true, destructiveHint: false, idempotentHint: true };
    case 'DELETE':
      return { readOnlyHint: false, destructiveHint: true, idempotentHint: true };
    case 'PUT':
    case 'PATCH':
      return { readOnlyHint: false, destructiveHint: false, idempotentHint: true };
    default:
      return { readOnlyHint: false, destructiveHint: false, idempotentHint: false };
  }
}

export function withoutFields(schema: McpInputSchema, names: string[]): McpInputSchema {
  const properties = { ...schema.properties };
  for (const name of names) delete properties[name];
  return {
    type: 'object',
    properties,
    required: schema.required.filter((name) => !names.includes(name)),
  };
}

function extractPathParams(path: string): string[] {
  return [...path.matchAll(/:([^/]+)/g)].map((m) => m[1]);
}

// hooks.params/query/body hold the TypeBox schema the route declared (a JSON
// Schema object with `properties`/`required`). Merge the three into one object
// schema for the tool's arguments. Path params are always added as required: a
// route often omits an explicit `params` schema for a string id, which would
// otherwise leave the path param out of the tool's arguments entirely.
interface SchemaShape {
  properties?: Record<string, unknown>;
  required?: unknown;
  anyOf?: SchemaShape[];
  oneOf?: SchemaShape[];
}

function jsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(jsonSchema);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'nullable')
      .map(([key, child]) => [
        key,
        ['properties', 'patternProperties', '$defs', 'definitions'].includes(key) &&
        child &&
        typeof child === 'object' &&
        !Array.isArray(child)
          ? Object.fromEntries(
              Object.entries(child).map(([name, schema]) => [name, jsonSchema(schema)]),
            )
          : jsonSchema(child),
      ]),
  );
}

function mergeInputSchema(hooks: Record<string, unknown>, pathParams: string[]): McpInputSchema {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const key of ['params', 'query', 'body'] as const) {
    const schema = hooks[key] as SchemaShape | undefined;
    if (!schema) continue;
    // A body declared as a union arrives as anyOf/oneOf with no properties of its
    // own. Offer every branch's properties and require only what all of them do, so
    // the caller sees the discriminator; the route still validates the combination.
    const branches = schema.anyOf ?? schema.oneOf;
    const parts = schema.properties ? [schema] : (branches ?? []);
    let common: string[] | null = null;
    for (const part of parts) {
      if (!part.properties) continue;
      for (const [name, value] of Object.entries(part.properties))
        properties[name] = jsonSchema(value);
      const names = Array.isArray(part.required) ? (part.required as string[]) : [];
      common = common === null ? names : common.filter((n) => names.includes(n));
    }
    if (common) required.push(...common);
  }
  for (const name of pathParams) {
    if (!(name in properties)) {
      properties[name] = { type: 'string', description: `Path parameter '${name}'.` };
    }
    required.push(name);
  }
  return { type: 'object', properties, required: [...new Set(required)] };
}

// "create_issue" → "Create issue", for a tool whose route has no summary.
export function toolTitle(tool: string): string {
  const words = tool.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// The tool table derived from an app's routes, built once per app and cached: routes
// are fixed after boot, so introspection runs on the first call only. Keyed by the app so a second app (a test's) gets its own table instead of
// inheriting whichever one was generated first.
const cache = new WeakMap<McpApp, McpRouteTool[]>();
export function routeTools(app: McpApp): McpRouteTool[] {
  let tools = cache.get(app);
  if (!tools) {
    tools = generateRouteTools(app);
    cache.set(app, tools);
  }
  return tools;
}

function generateRouteTools(app: McpApp): McpRouteTool[] {
  const tools: McpRouteTool[] = [];
  const catalog = new Map(routeToolCatalog.map((item) => [`${item.method} ${item.path}`, item]));
  for (const route of app.routes) {
    const hooks = route.hooks as Record<string, unknown>;
    const detail = hooks.detail as
      | {
          summary?: string;
          description?: string;
          'x-mcp'?: {
            tool?: string;
            annotations?: McpToolAnnotations;
            category?: ActionCategory;
            scope?: ActionScope;
            connector?: string;
          };
          'x-permission'?: DeclaredPermission;
          'x-access'?: McpRouteTool['access'];
        }
      | undefined;
    const catalogEntry = catalog.get(`${route.method} ${route.path}`);
    const tool = detail?.['x-mcp']?.tool ?? catalogEntry?.name;
    if (!tool) continue;
    const pathParams = extractPathParams(route.path);
    const annotations: McpToolAnnotations = {
      ...methodAnnotations(route.method),
      openWorldHint: false,
      ...(catalogEntry ? annotationsForCategory(catalogEntry.category as ActionCategory) : {}),
      ...detail?.['x-mcp']?.annotations,
    };
    tools.push({
      name: tool,
      title: detail?.summary ?? toolTitle(tool),
      // The MCP tool description is the full text an LLM reads to pick a tool.
      // Prefer the route's `description` (the long explanation); fall back to the
      // short `summary` (the OpenAPI title) and then the tool name.
      description:
        (detail?.description ?? detail?.summary ?? tool) +
        (catalogEntry || route.path.startsWith('/projects/:projectKey/receipts')
          ? ` Example: ${JSON.stringify(exampleInput(mergeInputSchema(hooks, pathParams)))}`
          : ''),
      method: route.method,
      path: route.path,
      pathParams,
      hasBody: hooks.body != null,
      inputSchema: mergeInputSchema(hooks, pathParams),
      outputSchema: outputSchema(
        tool === 'list_mail_threads_newest_first' ? { 200: CompactThreadPage } : hooks.response,
      ),
      permission: detail?.['x-permission'],
      ...(detail?.['x-access'] && { access: detail['x-access'] }),
      ...(detail?.['x-mcp']?.connector && { connector: detail['x-mcp'].connector }),
      // The catalog's action category supplies MCP hints for sends, publications,
      // credential changes and executions that the HTTP method cannot express.
      annotations,
      category:
        detail?.['x-mcp']?.category ??
        (catalogEntry?.category as ActionCategory | undefined) ??
        categoryFromAnnotations(annotations),
      scope: detail?.['x-mcp']?.scope ?? (catalogEntry?.scope as ActionScope | undefined),
    });
  }
  return tools;
}

function exampleInput(schema: McpInputSchema): Record<string, unknown> {
  return Object.fromEntries(
    schema.required.map((name) => {
      const field = schema.properties[name] as { type?: string; enum?: unknown[] } | undefined;
      const value =
        field?.enum?.[0] ??
        (field?.type === 'integer' || field?.type === 'number'
          ? 1
          : field?.type === 'boolean'
            ? true
            : name === 'projectKey'
              ? 'VOL'
              : name === 'email'
                ? 'person@example.com'
                : `your_${name}`);
      return [name, value];
    }),
  );
}
