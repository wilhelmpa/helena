import { z } from 'zod';
import {
  BUNDLE_FORMAT,
  BUNDLE_FORMAT_VERSION,
  validateBundle,
  type TemplateBundle,
} from '../templates';

// The shape of a template bundle as a schema, for the published JSON Schema
// (schema/helena.bundle.schema.json) and for checking an upload before validateBundle's
// rules (licenses, pinned sources, unique capabilities) run.

const skillSource = z.discriminatedUnion('type', [
  z.object({ type: z.literal('github'), url: z.url() }).strict(),
  z.object({ type: z.literal('files'), files: z.record(z.string(), z.string()) }).strict(),
]);

const mcpServer = z
  .object({
    type: z.enum(['stdio', 'http', 'sse']),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    url: z.string().optional(),
    description: z.string().optional(),
  })
  .strict();

const agent = z
  .object({
    name: z.string(),
    description: z.string(),
    instructions: z.string(),
    model: z.string().nullable(),
    effort: z.string().nullable(),
    maxTurns: z.number().int().nullable(),
    disallowedTools: z.array(z.string()),
    skills: z.array(z.string()),
    mcpServers: z.array(z.string()),
    helena: z
      .object({
        displayName: z.string(),
        roleTitle: z.string(),
        capabilities: z.array(z.string()),
        runBudgetSeconds: z.number().int().nullable(),
        triggers: z.object({ mention: z.boolean(), assign: z.boolean() }).strict(),
      })
      .strict(),
  })
  .strict();

const budget = z
  .object({
    metric: z.enum(['tokens', 'cost', 'time']),
    period: z.enum(['day', 'month']),
    limit: z.number().positive(),
  })
  .strict();

const department = z
  .object({
    name: z.string(),
    description: z.string(),
    restrictedSkills: z.boolean(),
    allowedSkills: z.array(z.string()),
    budgets: z.array(budget),
    agents: z.array(
      z
        .object({
          name: z.string(),
          role: z.enum(['coordinator', 'specialist', 'reviewer']).nullable(),
          reportsTo: z.string().nullable(),
          projects: z.array(z.string()),
          heartbeat: z
            .object({
              intervalMinutes: z.number().int().nullable(),
              timezone: z.string(),
              days: z.array(z.number().int()),
              start: z.string(),
              end: z.string(),
              instructions: z.string(),
            })
            .strict(),
          budgets: z.array(budget),
        })
        .strict(),
    ),
    goals: z.array(
      z
        .object({
          title: z.string(),
          description: z.string(),
          status: z.enum(['planned', 'active', 'achieved', 'paused']),
          targetDate: z.string().nullable(),
          parent: z.string().nullable(),
          project: z.string().nullable(),
        })
        .strict(),
    ),
    routines: z.array(
      z
        .object({
          key: z.string(),
          project: z.string(),
          agent: z.string(),
          title: z.string(),
          instructions: z.string(),
          cron: z.string(),
          timezone: z.string(),
          catchUp: z.enum(['skip', 'once']),
        })
        .strict(),
    ),
  })
  .strict();

export const templateBundleSchema = z
  .object({
    format: z.literal(BUNDLE_FORMAT),
    formatVersion: z.literal(BUNDLE_FORMAT_VERSION),
    name: z.string(),
    displayName: z.string(),
    version: z.string(),
    description: z.string(),
    license: z.string(),
    author: z.object({ name: z.string(), url: z.string().optional() }).strict(),
    skills: z.array(
      z
        .object({
          name: z.string(),
          source: skillSource,
          license: z.string(),
          attribution: z.string(),
        })
        .strict(),
    ),
    mcpServers: z.record(z.string(), mcpServer),
    agents: z.array(agent),
    department: department.optional(),
  })
  .strict() satisfies z.ZodType<TemplateBundle>;

// Checks an uploaded bundle: its shape, then Helena's rules. Throws with every problem.
export function checkBundle(raw: unknown): TemplateBundle {
  const result = templateBundleSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new Error(`Not a Helena template bundle: ${issues.join('; ')}`);
  }
  const bundle = result.data as TemplateBundle;
  const problems = validateBundle(bundle);
  if (problems.length > 0) throw new Error(`Invalid bundle: ${problems.join('; ')}`);
  return bundle;
}

export function bundleJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(templateBundleSchema, { target: 'draft-2020-12', io: 'input' });
  return {
    $schema: schema.$schema,
    $id: 'urn:helena:schema:template-bundle:v1',
    title: 'Helena template bundle',
    ...schema,
  };
}
