import type { PageObservation, TaskSuccess } from './types.ts';

export function taskSuccess(value: unknown): TaskSuccess | undefined {
  if (value === undefined) return undefined;
  const object = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v);
  const text = (v: unknown, max: number): v is string =>
    typeof v === 'string' && v.trim().length > 0 && v.length <= max;
  if (
    !object(value) ||
    Object.keys(value).some((key) => !['url', 'textIncludes', 'fields'].includes(key))
  )
    throw new Error('success must contain only url, textIncludes, and fields.');
  const result: TaskSuccess = {};
  if (value.url !== undefined) {
    if (!text(value.url, 2048)) throw new Error('success.url must be an HTTP(S) URL.');
    let url: URL;
    try {
      url = new URL(value.url);
    } catch {
      throw new Error('success.url must be an HTTP(S) URL.');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw new Error('success.url must be an HTTP(S) URL without credentials.');
    result.url = url.href;
  }
  if (value.textIncludes !== undefined) {
    if (
      !Array.isArray(value.textIncludes) ||
      value.textIncludes.length < 1 ||
      value.textIncludes.length > 10 ||
      !value.textIncludes.every((v) => text(v, 500))
    )
      throw new Error(
        'success.textIncludes needs 1–10 nonempty strings of at most 500 characters.',
      );
    result.textIncludes = value.textIncludes as string[];
  }
  if (value.fields !== undefined) {
    if (!Array.isArray(value.fields) || value.fields.length < 1 || value.fields.length > 10)
      throw new Error('success.fields needs 1–10 fields.');
    result.fields = value.fields.map((field: unknown) => {
      if (
        !object(field) ||
        Object.keys(field).some((key) => !['label', 'value', 'checked'].includes(key)) ||
        !text(field.label, 200) ||
        (field.value === undefined && field.checked === undefined) ||
        (field.value !== undefined &&
          (typeof field.value !== 'string' || field.value.length > 2000)) ||
        (field.checked !== undefined && typeof field.checked !== 'boolean')
      )
        throw new Error(
          'Each success field needs a unique visible label and a value and/or checked state.',
        );
      return {
        label: field.label,
        ...(field.value !== undefined ? { value: field.value as string } : {}),
        ...(field.checked !== undefined ? { checked: field.checked as boolean } : {}),
      };
    });
  }
  if (!Object.keys(result).length) throw new Error('success needs at least one criterion.');
  return result;
}

export function matchesSuccess(observation: PageObservation, success: TaskSuccess): boolean {
  try {
    success = taskSuccess(success)!;
  } catch {
    return false;
  }
  if (observation.jsDialog || !success) return false;
  if (success.url && observation.url !== success.url) return false;
  const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
  if (success.textIncludes?.some((text) => !clean(observation.text).includes(clean(text))))
    return false;
  for (const field of success.fields ?? []) {
    const matches = observation.elements.filter(
      (element) =>
        !element.credential &&
        !element.file &&
        !element.offscreen &&
        !element.covered &&
        clean(element.label ?? '') === clean(field.label),
    );
    if (matches.length !== 1) return false;
    const element = matches[0]!;
    if (field.value !== undefined && (element.valueExact !== true || element.value !== field.value))
      return false;
    if (field.checked !== undefined && element.checked !== field.checked) return false;
  }
  return true;
}
