import { threadHref } from '#modules/mail/threads/links';

type ClassificationResult = {
  status: string;
  issueId: number | null;
  actions: { kind: string }[];
} | null;

// Keep the source identity from the project-scoped pending query even if classification fails.
export async function triageMessageResult(
  projectKey: string,
  message: { id: number; threadId: number },
  classify: () => Promise<ClassificationResult>,
) {
  const source = {
    messageId: message.id,
    threadId: message.threadId,
    threadHref: threadHref(projectKey, message.threadId),
  };
  try {
    const result = await classify();
    return {
      ...source,
      status: result?.status ?? 'skipped',
      issueId: result?.issueId ?? null,
      actionFailed: result?.actions.some((action) => action.kind === 'skipped') ?? false,
    };
  } catch {
    return { ...source, status: 'failed', issueId: null, actionFailed: true };
  }
}
