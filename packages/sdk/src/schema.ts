import type { StandardJSONSchemaV1, StandardSchemaV1 } from '@standard-schema/spec';

// Schemas cross the SDK in two standard shapes, so no plugin is tied to one library:
//
//   - a Standard Schema (https://standardschema.dev): Zod 4, Valibot, ArkType … validate
//     through `~standard.validate`, and the ones that also implement Standard JSON Schema
//     (Zod 4 does) convert themselves to JSON Schema;
//   - a plain JSON Schema object, which is what TypeBox (the API's Elysia schemas) and
//     every MCP server already produce.
//
// JSON Schema is what travels: to MCP clients as a tool's inputSchema, to the web as a
// form description, into the plugin manifest.

export type JsonSchema = Record<string, unknown>;

export type SchemaLike<T = unknown> = StandardSchemaV1<unknown, T> | JsonSchema;

export function isStandardSchema(schema: unknown): schema is StandardSchemaV1 {
  return (
    !!schema &&
    typeof schema === 'object' &&
    '~standard' in schema &&
    typeof (schema as StandardSchemaV1)['~standard']?.validate === 'function'
  );
}

function hasJsonSchema(schema: unknown): schema is StandardJSONSchemaV1 {
  return (
    !!schema &&
    typeof schema === 'object' &&
    '~standard' in schema &&
    typeof (schema as StandardJSONSchemaV1)['~standard']?.jsonSchema?.input === 'function'
  );
}

export class SchemaError extends Error {
  constructor(
    message: string,
    readonly issues: ReadonlyArray<{ message: string; path?: string }> = [],
  ) {
    super(message);
    this.name = 'SchemaError';
  }
}

// The JSON Schema of what a caller passes in. A Standard Schema without the JSON Schema
// extension cannot describe itself, which is an error for a tool (an MCP client needs
// the schema) rather than something to guess.
export function toJsonSchema(schema: SchemaLike): JsonSchema {
  if (hasJsonSchema(schema)) {
    return schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' }) as JsonSchema;
  }
  if (isStandardSchema(schema)) {
    throw new SchemaError(
      `A ${schema['~standard'].vendor} schema without Standard JSON Schema support cannot be described as JSON Schema`,
    );
  }
  return schema;
}

function pathOf(issue: StandardSchemaV1.Issue): string | undefined {
  if (!issue.path?.length) return undefined;
  return issue.path
    .map((segment) =>
      typeof segment === 'object' && segment !== null ? String(segment.key) : String(segment),
    )
    .join('.');
}

// Validates a value against a Standard Schema and returns the parsed value. A plain JSON
// Schema is not validated here: the host that serves it (the MCP endpoint, the route)
// validates with its own validator, and the value passes through unchanged.
export async function validate<T>(schema: SchemaLike<T>, value: unknown): Promise<T> {
  if (!isStandardSchema(schema)) return value as T;
  const result = await schema['~standard'].validate(value);
  if (result.issues) {
    const issues = result.issues.map((issue) => ({ message: issue.message, path: pathOf(issue) }));
    const summary = issues
      .map((issue) => (issue.path ? `${issue.path}: ${issue.message}` : issue.message))
      .join('; ');
    throw new SchemaError(summary || 'Invalid value', issues);
  }
  return result.value as T;
}
