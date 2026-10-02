type Schema = Record<string, unknown>;

function accepts(schema: Schema, value: unknown): boolean {
  if (Array.isArray(schema.anyOf)) return schema.anyOf.some((branch) => accepts(branch, value));
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (
    schema.type !== undefined &&
    !types.includes(actual) &&
    !(types.includes('integer') && typeof value === 'number' && Number.isInteger(value))
  )
    return false;
  if (
    typeof schema.pattern === 'string' &&
    (typeof value !== 'string' || !new RegExp(schema.pattern).test(value))
  )
    return false;
  if (
    schema.format === 'uuid' &&
    (typeof value !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
  )
    return false;
  return true;
}

// Produces only schema-shaped values. Domain identities and conditional requirements
// belong to the named fixtures. Tests distinguish successful results from declared
// domain refusals and reject schema-invalid positive inputs before dispatch.
export function sample(schema: unknown, fields: Record<string, unknown> = {}, name = ''): unknown {
  if (!schema || typeof schema !== 'object') return 'ABSCHLUSSTEST';
  const s = schema as Schema;
  if ('const' in s) return s.const;
  if (Array.isArray(s.enum)) return s.enum[0];
  if (name in fields) {
    const value =
      s.type === 'string' && typeof fields[name] === 'number' ? String(fields[name]) : fields[name];
    if (accepts(s, value)) return value;
  }
  if ('default' in s) return s.default;
  const union = s.anyOf ?? s.oneOf;
  if (Array.isArray(union)) {
    const branch =
      union.find((item) => item.type !== 'null' && item.type !== 'string') ??
      union.find((item) => item.type !== 'null');
    return sample(branch, fields, name);
  }
  const type = Array.isArray(s.type) ? s.type.find((item) => item !== 'null') : s.type;
  if (type === 'null') return null;
  if (type === 'boolean') return false;
  if (type === 'number' || type === 'integer') {
    return Math.min(
      Number(s.maximum ?? Infinity),
      Math.max(Number(s.minimum ?? 1), Number(s.exclusiveMinimum ?? 0) + 1),
    );
  }
  if (type === 'array') {
    return Array.from({ length: Math.max(Number(s.minItems ?? 1), 1) }, () =>
      sample(s.items, fields, name.replace(/s$/, '')),
    );
  }
  if (type === 'object' || s.properties) {
    const properties = (s.properties ?? {}) as Record<string, unknown>;
    const object = Object.fromEntries(
      ((s.required ?? []) as string[]).map((key) => [key, sample(properties[key], fields, key)]),
    );
    if (Array.isArray(s.allOf))
      for (const branch of s.allOf) Object.assign(object, sample(branch, fields));
    return object;
  }
  if (s.format === 'email') return 'ABSCHLUSSTEST@example.test';
  if (s.format === 'date-time') return '2026-10-02T12:00:00.000Z';
  if (s.format === 'date') return '2026-10-02';
  if (s.format === 'uuid') return '00000000-0000-4000-8000-000000000214';
  if (s.format === 'uri' || /url$/i.test(name)) return 'https://example.test/ABSCHLUSSTEST';
  if (typeof s.pattern === 'string') {
    const pattern = new RegExp(s.pattern);
    const candidate = [
      'ABSCHLUSSTEST',
      'abschlusstest',
      '00000000-0000-4000-8000-000000000214',
      '2026-10',
      '2026-10-02',
      '2026-10-02T12:00:00.000Z',
      '09:00',
      'SOUL.md',
      'status',
      'abschlusstest.v1',
      'https://example.test/ABSCHLUSSTEST',
      'hub/abschlusstest',
      '1',
      'a'.repeat(32),
      'a'.repeat(40),
      'a'.repeat(64),
    ].find((value) => pattern.test(value));
    if (candidate) return candidate;
  }
  const value = 'ABSCHLUSSTEST';
  return value
    .repeat(Math.ceil(Number(s.minLength ?? 1) / value.length))
    .slice(0, Number(s.maxLength ?? 100));
}

export function invalidInput(
  schema: { properties: Record<string, unknown>; required?: string[] },
  valid: Record<string, unknown>,
) {
  const keys = [...(schema.required ?? []), ...Object.keys(schema.properties)];
  const key = keys.find((key) => {
    const field = schema.properties[key] as Schema | undefined;
    return (
      field && ['type', 'const', 'enum', 'anyOf', 'oneOf'].some((constraint) => constraint in field)
    );
  });
  return key ? { ...valid, [key]: { invalid: 'ABSCHLUSSTEST' } } : null;
}
