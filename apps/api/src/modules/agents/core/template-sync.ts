import {
  agentMcpServerLink,
  agentSkillLink,
  agentTemplateSyncLog,
  agentToolLink,
  aiAgent,
  db,
} from '@repo/db';
import { eq } from 'drizzle-orm';

// Helena is the source of truth for a template and every copy of it
// (copyTemplateIntoProject). A copy's own edits stick (they land in
// template_overrides), everything else follows the template the next time it changes,
// through this module — never a second time inside the runner or Mastra, which both
// read the resulting ai_agent row live (see runtime-policy/service.ts and
// pipelines/project-context.ts).
//
// The seven groups below are the ones the owner named for template following: Skills,
// Tools, MCP servers, Freigabe-Regeln (approvals), Anweisungen (instructions), Modell +
// Reasoning-Standard (one group, both live together conceptually), and Budgets. Each
// maps onto one or more ai_agent columns; three of them (model, approvals, budgets)
// plus instructions' file list all share the single runtime_policy jsonb column, so
// applying them is a merge, not an overwrite of the whole document.
export const TEMPLATE_FIELD_GROUPS = [
  'skills',
  'tools',
  'mcpServers',
  'approvals',
  'instructions',
  'model',
  'budgets',
] as const;

export type TemplateFieldGroup = (typeof TEMPLATE_FIELD_GROUPS)[number];

export function isTemplateFieldGroup(value: string): value is TemplateFieldGroup {
  return (TEMPLATE_FIELD_GROUPS as readonly string[]).includes(value);
}

// A loose shape for runtime_policy as read back from jsonb: every write already ran it
// through normalizeRuntimePolicy (core/service.ts), so the fields below are always
// present on a real row, but nothing here depends on importing that module (avoiding a
// service.ts <-> template-sync.ts import cycle: service.ts calls into this file, not
// the other way around).
interface RuntimePolicyLike {
  reasoningEffort?: string | null;
  toolAllow?: string[];
  toolDeny?: string[];
  mcpGrants?: string[];
  files?: unknown[];
  maxTurns?: number | null;
  runBudgetSeconds?: number | null;
  [key: string]: unknown;
}

function asPolicy(value: unknown): RuntimePolicyLike {
  return value && typeof value === 'object' ? (value as RuntimePolicyLike) : {};
}

function sameArray(a: unknown[] | undefined, b: unknown[] | undefined): boolean {
  const x = a ?? [];
  const y = b ?? [];
  return x.length === y.length && x.every((value, index) => value === y[index]);
}

// Which groups actually changed between a previous and a next runtime_policy — used so
// a generic "PATCH runtimePolicy" (the only entry point the agent editor has for
// reasoning/approvals/budgets sub-fields) marks a copy's override, or fans a template's
// change out to its copies, only for the groups whose values really moved.
export function runtimePolicyGroupsChanged(previous: unknown, next: unknown): TemplateFieldGroup[] {
  const prev = asPolicy(previous);
  const nxt = asPolicy(next);
  const groups: TemplateFieldGroup[] = [];
  if (prev.reasoningEffort !== nxt.reasoningEffort) groups.push('model');
  if (
    !sameArray(prev.toolAllow, nxt.toolAllow) ||
    !sameArray(prev.toolDeny, nxt.toolDeny) ||
    !sameArray(prev.mcpGrants, nxt.mcpGrants)
  ) {
    groups.push('approvals');
  }
  if (prev.maxTurns !== nxt.maxTurns || prev.runBudgetSeconds !== nxt.runBudgetSeconds) {
    groups.push('budgets');
  }
  if (JSON.stringify(prev.files ?? []) !== JSON.stringify(nxt.files ?? [])) {
    groups.push('instructions');
  }
  return groups;
}

// Called by a template's own mutation paths, or by a copy's. A template row and a copy
// row never coincide (enforced by ai_agent_template_no_source_check), so this always
// does exactly one of the two things below, or nothing for a plain (non-template,
// non-copy) agent.
export async function onTemplateRelevantChange(
  agentId: number,
  groups: TemplateFieldGroup[],
): Promise<void> {
  if (groups.length === 0) return;
  const [row] = await db
    .select({ template: aiAgent.template, sourceTemplateId: aiAgent.sourceTemplateId })
    .from(aiAgent)
    .where(eq(aiAgent.id, agentId))
    .limit(1);
  if (!row) return;
  if (row.template) await syncTemplateToCopies(agentId, groups);
  else if (row.sourceTemplateId != null) await markOverridden(agentId, groups);
}

// Records that a copy's owner changed these groups directly, so the next template sync
// leaves them alone until "reset to template" clears the flag again.
export async function markOverridden(agentId: number, groups: TemplateFieldGroup[]): Promise<void> {
  if (groups.length === 0) return;
  const [row] = await db
    .select({ overrides: aiAgent.templateOverrides })
    .from(aiAgent)
    .where(eq(aiAgent.id, agentId))
    .limit(1);
  if (!row) return;
  const next = new Set([...(row.overrides ?? []), ...groups]);
  await db
    .update(aiAgent)
    .set({ templateOverrides: [...next] })
    .where(eq(aiAgent.id, agentId));
}

interface TemplateRow {
  id: number;
  teamId: number;
  instructions: string | null;
  model: string | null;
  runtimePolicy: unknown;
  dailyTokenCeiling: number | null;
  monthlyTokenCeiling: number | null;
}

async function loadTemplateRow(id: number): Promise<TemplateRow | null> {
  const [row] = await db
    .select({
      id: aiAgent.id,
      teamId: aiAgent.teamId,
      template: aiAgent.template,
      instructions: aiAgent.instructions,
      model: aiAgent.model,
      runtimePolicy: aiAgent.runtimePolicy,
      dailyTokenCeiling: aiAgent.dailyTokenCeiling,
      monthlyTokenCeiling: aiAgent.monthlyTokenCeiling,
    })
    .from(aiAgent)
    .where(eq(aiAgent.id, id))
    .limit(1);
  if (!row || !row.template) return null;
  return row;
}

async function syncSkillLinks(copyId: number, templateId: number): Promise<void> {
  const rows = await db
    .select({ skillId: agentSkillLink.skillId })
    .from(agentSkillLink)
    .where(eq(agentSkillLink.agentId, templateId));
  await db.delete(agentSkillLink).where(eq(agentSkillLink.agentId, copyId));
  if (rows.length > 0) {
    await db
      .insert(agentSkillLink)
      .values(rows.map((r) => ({ agentId: copyId, skillId: r.skillId })));
  }
}

async function syncMcpServerLinks(copyId: number, templateId: number): Promise<void> {
  const rows = await db
    .select({ mcpServerId: agentMcpServerLink.mcpServerId })
    .from(agentMcpServerLink)
    .where(eq(agentMcpServerLink.agentId, templateId));
  await db.delete(agentMcpServerLink).where(eq(agentMcpServerLink.agentId, copyId));
  if (rows.length > 0) {
    await db
      .insert(agentMcpServerLink)
      .values(rows.map((r) => ({ agentId: copyId, mcpServerId: r.mcpServerId })));
  }
}

async function syncToolLinks(copyId: number, templateId: number): Promise<void> {
  const rows = await db
    .select({ agentToolId: agentToolLink.agentToolId })
    .from(agentToolLink)
    .where(eq(agentToolLink.agentId, templateId));
  await db.delete(agentToolLink).where(eq(agentToolLink.agentId, copyId));
  if (rows.length > 0) {
    await db
      .insert(agentToolLink)
      .values(rows.map((r) => ({ agentId: copyId, agentToolId: r.agentToolId })));
  }
}

function mergedRuntimePolicy(
  current: RuntimePolicyLike,
  template: RuntimePolicyLike,
  groups: TemplateFieldGroup[],
): RuntimePolicyLike {
  const next = { ...current };
  if (groups.includes('instructions')) next.files = template.files ?? [];
  if (groups.includes('model')) next.reasoningEffort = template.reasoningEffort ?? null;
  if (groups.includes('approvals')) {
    next.toolAllow = template.toolAllow ?? [];
    next.toolDeny = template.toolDeny ?? [];
    next.mcpGrants = template.mcpGrants ?? [];
  }
  if (groups.includes('budgets')) {
    next.maxTurns = template.maxTurns ?? null;
    next.runBudgetSeconds = template.runBudgetSeconds ?? null;
  }
  return next;
}

async function applyGroupsToCopy(
  template: TemplateRow,
  copy: { id: number; runtimePolicy: unknown },
  groups: TemplateFieldGroup[],
): Promise<void> {
  const set: Partial<typeof aiAgent.$inferInsert> = {};
  if (groups.includes('instructions')) set.instructions = template.instructions;
  if (groups.includes('model')) set.model = template.model;
  if (groups.includes('budgets')) {
    set.dailyTokenCeiling = template.dailyTokenCeiling;
    set.monthlyTokenCeiling = template.monthlyTokenCeiling;
  }
  const policyGroups = groups.filter(
    (g): g is 'instructions' | 'model' | 'approvals' | 'budgets' =>
      g === 'instructions' || g === 'model' || g === 'approvals' || g === 'budgets',
  );
  if (policyGroups.length > 0) {
    set.runtimePolicy = mergedRuntimePolicy(
      asPolicy(copy.runtimePolicy),
      asPolicy(template.runtimePolicy),
      policyGroups,
    );
  }
  if (Object.keys(set).length > 0) {
    await db.update(aiAgent).set(set).where(eq(aiAgent.id, copy.id));
  }
  if (groups.includes('skills')) await syncSkillLinks(copy.id, template.id);
  if (groups.includes('mcpServers')) await syncMcpServerLinks(copy.id, template.id);
  if (groups.includes('tools')) await syncToolLinks(copy.id, template.id);
}

async function logSync(
  teamId: number,
  templateId: number,
  copyId: number,
  groups: TemplateFieldGroup[],
): Promise<void> {
  if (groups.length === 0) return;
  await db.insert(agentTemplateSyncLog).values({ teamId, templateId, copyId, groups });
}

// Fans a template's change out to every copy that has not overridden the given groups.
// A group a copy overrode is skipped for that copy only; the sync still runs for its
// other groups and for every other copy.
export async function syncTemplateToCopies(
  templateId: number,
  groups: TemplateFieldGroup[],
): Promise<void> {
  if (groups.length === 0) return;
  const template = await loadTemplateRow(templateId);
  if (!template) return;
  const copies = await db
    .select({
      id: aiAgent.id,
      runtimePolicy: aiAgent.runtimePolicy,
      templateOverrides: aiAgent.templateOverrides,
    })
    .from(aiAgent)
    .where(eq(aiAgent.sourceTemplateId, templateId));
  for (const copy of copies) {
    const overrides = new Set(copy.templateOverrides ?? []);
    const toApply = groups.filter((g) => !overrides.has(g));
    if (toApply.length === 0) continue;
    await applyGroupsToCopy(template, copy, toApply);
    await db.update(aiAgent).set({ templateSyncedAt: new Date() }).where(eq(aiAgent.id, copy.id));
    await logSync(template.teamId, templateId, copy.id, toApply);
  }
}

// "Auf Vorlage zurücksetzen": drops one group's override and immediately re-applies the
// template's current value for it. Returns false when the agent is not a copy (or has
// none of this group in its overrides — the caller can no-op that itself).
export async function resetCopyToTemplate(
  copyId: number,
  teamId: number,
  group: TemplateFieldGroup,
): Promise<boolean> {
  const [copy] = await db
    .select({
      id: aiAgent.id,
      teamId: aiAgent.teamId,
      sourceTemplateId: aiAgent.sourceTemplateId,
      runtimePolicy: aiAgent.runtimePolicy,
      templateOverrides: aiAgent.templateOverrides,
    })
    .from(aiAgent)
    .where(eq(aiAgent.id, copyId))
    .limit(1);
  if (!copy || copy.teamId !== teamId || copy.sourceTemplateId == null) return false;
  const template = await loadTemplateRow(copy.sourceTemplateId);
  if (!template) return false;
  await applyGroupsToCopy(template, copy, [group]);
  const remaining = (copy.templateOverrides ?? []).filter((g) => g !== group);
  await db
    .update(aiAgent)
    .set({ templateOverrides: remaining, templateSyncedAt: new Date() })
    .where(eq(aiAgent.id, copyId));
  await logSync(teamId, copy.sourceTemplateId, copyId, [group]);
  return true;
}
