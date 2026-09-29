// What the chat in Helena's panel sees of the page behind it (owner, 28.09., O50): the
// project, the task open in front of the reader, the document open in the knowledge. It is
// sent with each question as the page context (the API names it to the agent) and shown
// above the chat in words, not as a path.

export interface ChatPageContext {
  projectKey: string | null;
  path: string;
}

export type ChatContextItem =
  { kind: 'task'; identifier: string; title: string } | { kind: 'document'; name: string };

const PAGE_PARAMS = ['file', 'path', 'root', 'view'] as const;

// The page address the question carries: the path, the parameters that name what is open
// (a knowledge file, a view), and the task in the side panel, which has no address of its
// own.
export function chatPagePath(
  pathname: string,
  params: { get(name: string): string | null },
  task: { identifier: string } | null,
): string {
  const query = new URLSearchParams();
  for (const key of PAGE_PARAMS) {
    const value = params.get(key);
    if (value) query.set(key, value);
  }
  if (task && !pathname.includes('/issue/')) query.set('task', task.identifier);
  return `${pathname}${query.size ? `?${query.toString()}` : ''}`;
}

// The open thing the context line names: the task first (it is in front), else a document
// of the knowledge by its file name.
export function chatContextItem(
  params: { get(name: string): string | null },
  task: { identifier: string; title: string } | null,
): ChatContextItem | null {
  if (task) return { kind: 'task', identifier: task.identifier, title: task.title };
  const file = params.get('file') ?? params.get('path');
  if (!file) return null;
  const name = file.split('/').filter(Boolean).at(-1);
  return name ? { kind: 'document', name } : null;
}
