import type { RuntimeSession } from '@/lib/api/endpoints/agentRuntime';

// What a session was in Helena (the task of its run, the title of its chat), else the
// runtime's own title.
export function sessionTitle(session: RuntimeSession | null | undefined, fallback: string): string {
  const link = session?.link;
  if (link?.issueIdentifier) {
    return link.issueTitle ? `${link.issueIdentifier} · ${link.issueTitle}` : link.issueIdentifier;
  }
  return link?.chatTitle ?? session?.title ?? session?.preview ?? fallback;
}
