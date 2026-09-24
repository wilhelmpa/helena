// The contracts of Helena's extension points that connectors use: action categories, the
// connector and its tools, and policy evaluators. They mirror `@helena/sdk`
// (packages/sdk on hub/framework) name for name, so that once the SDK lands this file
// becomes a re-export of it and nothing else changes.

export const ACTION_CATEGORIES = [
  // Looks, changes nothing.
  'read',
  // Changes data the account holds; undoable.
  'write',
  // Runs code or a command.
  'execute',
  // Reaches a person or system outside Helena: a mail, an invitation.
  'send',
  // Removes something.
  'delete',
  // Makes something visible to others: a shared file, a post.
  'publish',
  // Spends money.
  'pay',
] as const;

export type ActionCategory = (typeof ACTION_CATEGORIES)[number];

export function isActionCategory(value: unknown): value is ActionCategory {
  return typeof value === 'string' && (ACTION_CATEGORIES as readonly string[]).includes(value);
}

// The standard MCP tool annotations a category implies.
export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export function annotationsForCategory(category: ActionCategory): ToolAnnotations {
  switch (category) {
    case 'read':
      return { readOnlyHint: true, destructiveHint: false };
    case 'write':
      return { readOnlyHint: false, destructiveHint: false };
    case 'execute':
      return { readOnlyHint: false, destructiveHint: true, openWorldHint: true };
    case 'send':
    case 'publish':
    case 'pay':
      return { readOnlyHint: false, destructiveHint: false, openWorldHint: true };
    case 'delete':
      return { readOnlyHint: false, destructiveHint: true };
  }
}

export type JsonSchema = Record<string, unknown>;

// A label in the languages Helena ships; the web shows the viewer's, English otherwise.
export type LocalizedText = string | { en: string; [locale: string]: string };

export type CredentialFieldType = 'string' | 'secret' | 'url' | 'number' | 'boolean' | 'text';

export interface CredentialField {
  key: string;
  label: LocalizedText;
  type: CredentialFieldType;
  required: boolean;
}

// One service an account opens (Mail, Calendar …), with the action categories its tools
// take. Grants and the policy are expressed in them.
export interface ConnectorService {
  id: string;
  label: LocalizedText;
  actions: ActionCategory[];
  // The OAuth scopes the service needs, for a connector that signs in with OAuth.
  scopes?: string[];
}

export interface ConnectorHealth {
  status: 'ok' | 'needs_auth' | 'error';
  message?: string;
}

// An agent tool of a connector: an MCP tool (name, description, JSON-Schema input) plus
// the action category the policy decides on and the service it belongs to. `Context` is
// what the connector hands its tools to reach the account.
export interface ConnectorTool<Context = unknown, Input = Record<string, unknown>> {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  service: string;
  category: ActionCategory | ((input: Input) => ActionCategory);
  // One line a person reads on the approval card and in the audit log.
  summarize(input: Input): string;
  handler(input: Input, ctx: Context): Promise<unknown>;
}

export interface Connector {
  id: string;
  label: LocalizedText;
  // A lucide icon name.
  icon?: string;
  // 'account': a sign-in with services and tools (Google, an MCP/OAuth server).
  // 'credential': a secret something else uses (a web login, an SSH key).
  kind: 'account' | 'credential';
  credentialSchema: CredentialField[];
  services: ConnectorService[];
  tools: ConnectorTool<never, never>[];
}

export function toolCategory<Input>(
  tool: Pick<ConnectorTool<unknown, Input>, 'category'>,
  input: Input,
): ActionCategory {
  return typeof tool.category === 'function' ? tool.category(input) : tool.category;
}

// The widest category a tool can have, for a catalog.
export function declaredCategory(tool: Pick<ConnectorTool, 'category'>): ActionCategory {
  return typeof tool.category === 'string' ? tool.category : 'send';
}

// The policy seam: may this agent take an action of this category here? Evaluators are
// composed; the strictest answer wins and one that has no opinion abstains.
export interface PolicyRequest {
  agent: { id: number; name?: string } | null;
  project: { id: number; key?: string } | null;
  action: ActionCategory;
  context: {
    tool?: string;
    connector?: string;
    service?: string;
    target?: string;
    runId?: number | null;
    // What the access center found for the agent: the grant it holds on the account.
    grant?: { access: 'read' | 'write' } | null;
  };
}

export type PolicyEffect = 'allow' | 'needs-approval' | 'deny';

export interface PolicyDecision {
  effect: PolicyEffect;
  reason: string;
  evaluator?: string;
}

export interface PolicyEvaluator {
  id: string;
  evaluate(request: PolicyRequest): PolicyDecision | null | Promise<PolicyDecision | null>;
}

const STRICTNESS: Record<PolicyEffect, number> = { allow: 0, 'needs-approval': 1, deny: 2 };

export async function decide(
  evaluators: Iterable<PolicyEvaluator>,
  request: PolicyRequest,
): Promise<PolicyDecision> {
  let result: PolicyDecision | null = null;
  for (const evaluator of evaluators) {
    let decision: PolicyDecision | null;
    try {
      decision = await evaluator.evaluate(request);
    } catch (error) {
      decision = {
        effect: 'deny',
        reason: `Policy ${evaluator.id} failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    if (!decision) continue;
    const stamped = { ...decision, evaluator: decision.evaluator ?? evaluator.id };
    if (!result || STRICTNESS[stamped.effect] > STRICTNESS[result.effect]) result = stamped;
    if (result.effect === 'deny') break;
  }
  return result ?? { effect: 'allow', reason: 'No policy applies', evaluator: 'default' };
}

// A registry of extensions by id: register, look up, list. A second registration under
// the same id is an error.
export class Registry<T extends { id: string }> {
  private readonly entries = new Map<string, T>();

  constructor(readonly kind: string) {}

  register(value: T): () => void {
    if (this.entries.has(value.id)) throw new Error(`Duplicate ${this.kind} "${value.id}"`);
    this.entries.set(value.id, value);
    return () => {
      if (this.entries.get(value.id) === value) this.entries.delete(value.id);
    };
  }

  get(id: string): T | undefined {
    return this.entries.get(id);
  }

  list(): T[] {
    return [...this.entries.values()];
  }
}
