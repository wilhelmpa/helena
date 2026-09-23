export type InternalLinkTarget =
  | { kind: 'project'; projectKey: string }
  | { kind: 'issueId'; id: number }
  | { kind: 'document'; path: string }
  | { kind: 'issue' | 'notes' | 'view'; projectKey: string; id: number };

function positiveId(value: string | undefined) {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

// A note of the vault as the Docs pages open it: /docs?path=... for Home and
// /project/KEY/docs?path=... for a project.
function documentTarget(url: URL, parts: string[]): InternalLinkTarget | null {
  const isDocs =
    (parts.length === 1 && parts[0] === 'docs') ||
    (parts.length === 3 && parts[0] === 'project' && parts[2] === 'docs');
  const path = url.searchParams.get('path');
  if (!isDocs || !path || /\p{Cc}/u.test(path)) return null;
  return { kind: 'document', path };
}

export function internalLinkTarget(url: URL): InternalLinkTarget | null {
  let parts: string[];
  try {
    parts = url.pathname.replace(/\/$/, '').split('/').slice(1).map(decodeURIComponent);
  } catch {
    return null;
  }
  if (parts.some((part) => /[/\\?#\p{Cc}]/u.test(part))) return null;
  const document = documentTarget(url, parts);
  if (document) return document;
  if (parts.length === 1) {
    const match = /^(.+)-(\d+)$/.exec(parts[0]!);
    const id = positiveId(match?.[2]);
    return match && id ? { kind: 'issue', projectKey: match[1]!, id } : null;
  }
  if (parts[0] === 'issue' && parts.length === 2) {
    const id = positiveId(parts[1]);
    return id ? { kind: 'issueId', id } : null;
  }
  if (parts[0] !== 'project' || !parts[1]) return null;
  const projectKey = parts[1];
  if (parts.length === 2) return { kind: 'project', projectKey };
  if (parts.length !== 4) return null;
  const id = positiveId(parts[3]);
  if (!id) return null;
  switch (parts[2]) {
    case 'issue':
      return { kind: 'issue', projectKey, id };
    case 'notes':
      return { kind: 'notes', projectKey, id };
    case 'view':
      return { kind: 'view', projectKey, id };
    default:
      return null;
  }
}
