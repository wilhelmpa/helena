import { t } from 'elysia';

// A calendar day, as the `date` columns hold it.
export const isoDate = (description: string) =>
  t.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', format: 'date', description });

// A choice between string values, in every schema. Elysia's t.UnionEnum gives its schema the
// first value as the default, and Elysia fills defaults into a request's body, query, params
// and headers, so a request that leaves the field out silently gets that value: an optional field
// is filled in (a partial PUT /god/auth-settings set registration to "open") and a required
// one never fails (an SMTP body without encryption became "none"). The same happens inside
// t.Partial, t.Nullable or through a variable. oneOf is t.UnionEnum without that default: the
// same `{ type: 'string', enum }` in the OpenAPI document and the MCP tool schemas, and the
// same literal union as its type. Elysia keeps the default only for the example value in a
// development-mode validation message, which the API does not return. This is the one place
// that builds a t.UnionEnum; lint and shared/__tests__/unit/request-enums.test.ts refuse it
// anywhere else.
export function oneOf<const T extends readonly [string, ...string[]]>(
  values: T,
  options?: Parameters<typeof t.UnionEnum>[1],
): ReturnType<typeof t.UnionEnum<T>> {
  const schema = t.UnionEnum(values, options);
  if (options?.default === undefined) delete (schema as { default?: unknown }).default;
  return schema;
}
