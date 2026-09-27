// The inbox of the project (or Home) with the thread open.
export function threadHref(projectKey: string | null, threadId: number): string {
  return `${projectKey ? `/project/${projectKey}` : ''}/inbox?thread=${threadId}`;
}
