import { t } from 'elysia';

// A calendar day, as the `date` columns hold it.
export const isoDate = (description: string) =>
  t.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', format: 'date', description });

// A choice between string values in a request schema. Elysia's t.UnionEnum gives its schema
// the first value as the default, so a request that leaves the field out silently gets that
// value: an optional field is filled in (a partial PUT /god/auth-settings set registration to
// "open") and a required one never fails (an SMTP body without encryption became "none"). A
// union of literals has no default. The type is t.UnionEnum's, so handlers keep the literal
// union; only the runtime schema differs.
export function oneOf<const T extends readonly [string, ...string[]]>(
  values: T,
  options?: Parameters<typeof t.UnionEnum>[1],
): ReturnType<typeof t.UnionEnum<T>> {
  return t.Union(
    values.map((value) => t.Literal(value)),
    options,
  ) as unknown as ReturnType<typeof t.UnionEnum<T>>;
}
