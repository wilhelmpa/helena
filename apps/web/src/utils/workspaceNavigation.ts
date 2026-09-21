import { projectPath } from './paths';

export function safeProjectDestination(projectKey: string, saved: string | null): string {
  const base = projectPath(projectKey);
  if (
    !saved ||
    saved.length > 500 ||
    /[\\?#]/.test(saved) ||
    [...saved].some((char) => char.charCodeAt(0) < 32)
  )
    return base;
  if (saved !== base && !saved.startsWith(`${base}/`)) return base;
  // Do not accept encoded separators or dot segments from browser storage.
  if (
    /%(?:2f|5c|2e)/i.test(saved) ||
    saved.split('/').some((part) => part === '.' || part === '..')
  )
    return base;
  return saved;
}
