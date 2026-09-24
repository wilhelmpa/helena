import * as cedar from '@cedar-policy/cedar-wasm/nodejs';
import type { ExtraPolicy, PolicyDecision, PolicyEvaluator, PolicyRequest } from './evaluator';
import { AUTOPILOT_POLICIES, AUTOPILOT_SCHEMA, REASON_BY_POLICY } from './policies';

// The policy engine on Cedar (docs/helena-decisions/policy-engine.md), in-process through
// Cedar's WebAssembly build. Each decision is up to two Cedar requests: the action as it
// is, and, when that is denied, the same action as if a person had approved it. Allowed
// the first time: allow. Only the second time: needs-approval. Never: deny.

const SCHEMA_NAME = 'helena-autopilot';

function describe(errors: { message: string }[]): string {
  return errors.map((error) => error.message).join('; ');
}

export class CedarPolicyEvaluator implements PolicyEvaluator {
  private readonly policies = new Map<string, string>(Object.entries(AUTOPILOT_POLICIES));
  private readonly reasons = new Map<string, string>();
  private setId: string | null = null;
  private generation = 0;

  constructor() {
    const schema = cedar.preparseSchema(SCHEMA_NAME, AUTOPILOT_SCHEMA);
    if (schema.type !== 'success') throw new Error(`Cedar schema: ${describe(schema.errors)}`);
    this.validate(Object.fromEntries(this.policies));
  }

  addPolicies(source: string, policies: ExtraPolicy[]): void {
    const next = new Map(this.policies);
    for (const policy of policies) {
      const id = `${source}/${policy.id}`;
      if (next.has(id)) throw new Error(`Policy ${id} is already loaded`);
      next.set(id, policy.text);
    }
    this.validate(Object.fromEntries(next));
    for (const policy of policies) {
      const id = `${source}/${policy.id}`;
      this.policies.set(id, policy.text);
      this.reasons.set(id, policy.reason);
    }
    this.setId = null;
  }

  evaluate(request: PolicyRequest): PolicyDecision {
    const first = this.authorize(request, request.approved === true);
    if (first.decision === 'allow') return this.explain('allow', first.reason);
    if (request.approved) return this.explain('deny', first.reason);
    const second = this.authorize(request, true);
    return second.decision === 'allow'
      ? this.explain('needs-approval', first.reason)
      : this.explain('deny', second.reason);
  }

  private explain(outcome: PolicyDecision['outcome'], policyIds: string[]): PolicyDecision {
    const ids = [...policyIds].sort();
    const extra = ids.find((id) => this.reasons.has(id));
    if (extra)
      return { outcome, reason: 'policy', policyIds: ids, detail: this.reasons.get(extra) };
    const codes = ids.map((id) => REASON_BY_POLICY[id]).filter(Boolean);
    const pick = (...wanted: PolicyDecision['reason'][]) =>
      wanted.find((code) => codes.includes(code));
    if (outcome === 'allow')
      return {
        outcome,
        reason: pick('approved', 'level-allows', 'always-allowed') ?? 'level-allows',
        policyIds: ids,
      };
    return {
      outcome,
      reason: pick('budget-exhausted', 'hard-block') ?? 'level-requires-approval',
      policyIds: ids,
    };
  }

  private preparsed(): string {
    if (this.setId) return this.setId;
    const id = `helena-autopilot-${++this.generation}`;
    const answer = cedar.preparsePolicySet(id, {
      staticPolicies: Object.fromEntries(this.policies),
    });
    if (answer.type !== 'success') throw new Error(`Cedar policies: ${describe(answer.errors)}`);
    this.setId = id;
    return id;
  }

  private authorize(
    request: PolicyRequest,
    approved: boolean,
  ): { decision: 'allow' | 'deny'; reason: string[] } {
    const answer = cedar.statefulIsAuthorized({
      principal: { type: 'Helena::Agent', id: String(request.agentId ?? 'none') },
      action: { type: 'Helena::Action', id: request.category },
      resource: { type: 'Helena::Project', id: String(request.projectId ?? 'none') },
      context: {
        level: request.level,
        scope: request.scope,
        approved,
        budgetExhausted: request.budgetExhausted === true,
      },
      preparsedSchemaName: SCHEMA_NAME,
      validateRequest: true,
      preparsedPolicySetId: this.preparsed(),
      entities: [],
    });
    if (answer.type !== 'success') throw new Error(`Cedar: ${describe(answer.errors)}`);
    const { decision, diagnostics } = answer.response;
    if (diagnostics.errors.length > 0) {
      // A policy that errors is skipped by Cedar; a forbid that errors must not let an action
      // through, so the request is denied.
      return { decision: 'deny', reason: diagnostics.errors.map((error) => error.policyId) };
    }
    return { decision, reason: diagnostics.reason };
  }

  private validate(policies: Record<string, string>): void {
    const answer = cedar.validate({
      schema: AUTOPILOT_SCHEMA,
      policies: { staticPolicies: policies },
      validationSettings: { mode: 'strict' },
    });
    if (answer.type !== 'success') throw new Error(`Cedar policies: ${describe(answer.errors)}`);
    if (answer.validationErrors.length > 0) {
      throw new Error(
        `Cedar policies: ${answer.validationErrors
          .map((error) => `${error.policyId}: ${error.error.message}`)
          .join('; ')}`,
      );
    }
  }
}

let shared: CedarPolicyEvaluator | null = null;

// The one evaluator of the process.
export function policyEvaluator(): CedarPolicyEvaluator {
  shared ??= new CedarPolicyEvaluator();
  return shared;
}
