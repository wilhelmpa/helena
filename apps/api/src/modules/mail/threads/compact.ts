import { t } from 'elysia';

export function compactMailSnippet(value: string): string {
  return [
    ...value
      .replace(/[\p{Default_Ignorable_Code_Point}\u2800]/gu, '')
      .replace(/\s+/gu, ' ')
      .trim(),
  ]
    .slice(0, 160)
    .join('');
}

export const CompactThreadPage = t.Object({
  items: t.Array(
    t.Object({
      id: t.Number(),
      accountId: t.Number(),
      projectId: t.Nullable(t.Number()),
      projectKey: t.Nullable(t.String()),
      subject: t.String(),
      lastMessageAt: t.String(),
      fromName: t.String(),
      fromAddress: t.String(),
      snippet: t.String(),
      unread: t.Boolean(),
      triage: t.Nullable(
        t.Object({
          status: t.String(),
          category: t.Nullable(t.String()),
          priority: t.Nullable(t.String()),
          needsReply: t.Nullable(t.Boolean()),
        }),
      ),
    }),
  ),
  nextCursor: t.Nullable(t.String()),
});

export function compactThreadPage(
  value: typeof CompactThreadPage.static,
): typeof CompactThreadPage.static {
  return {
    items: value.items.map(
      ({
        id,
        accountId,
        projectId,
        projectKey,
        subject,
        lastMessageAt,
        fromName,
        fromAddress,
        snippet,
        unread,
        triage,
      }) => ({
        id,
        accountId,
        projectId,
        projectKey,
        subject,
        lastMessageAt,
        fromName,
        fromAddress,
        snippet: compactMailSnippet(snippet),
        unread,
        triage,
      }),
    ),
    nextCursor: value.nextCursor,
  };
}
