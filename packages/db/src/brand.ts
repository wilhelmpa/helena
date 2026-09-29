import { getSetting, setSetting } from './settings';

export const DEFAULT_DISPLAY_NAME = 'Helena';
export const DISPLAY_NAME_SETTING_KEY = 'brand.displayName';

export function validDisplayName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 40 &&
    /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} .&_-]*$/u.test(value) &&
    value === value.trim()
  );
}

export async function getDisplayName(): Promise<string> {
  const stored = await getSetting<unknown>(DISPLAY_NAME_SETTING_KEY);
  if (validDisplayName(stored)) return stored;
  const fallback = process.env.APP_NAME;
  return validDisplayName(fallback) ? fallback : DEFAULT_DISPLAY_NAME;
}

export async function setDisplayName(value: string): Promise<string> {
  if (!validDisplayName(value)) throw new Error('Invalid display name');
  await setSetting(DISPLAY_NAME_SETTING_KEY, value);
  return value;
}
