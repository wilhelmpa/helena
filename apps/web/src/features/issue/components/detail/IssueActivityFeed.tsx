import { useState } from 'react';
import type { IssueActivityView } from '@/lib/api/endpoints/userPreferences';
import type { Column } from '@/lib/api/endpoints/columns';
import type { Assignee } from '@/lib/api/endpoints/projects';
import { useSession } from '@/lib/auth-client';
import { Inline, Segmented, Stack } from '@/design-system';
import { useAccountPreferencesQuery } from '@/services/preferences.service';
import CommentComposer, { type ComposerContext } from './CommentComposer';
import IssueFeedList from './IssueFeedList';
import IssueGroupedFeed from './IssueGroupedFeed';
import { useTranslations } from 'next-intl';

// The issue's activity log: a comment composer over the entries, in one of two shapes
// picked by the tabs between them. Both run newest first and page 25 at a time; the
// grouped one splits the entries by the status the issue was in when each was written.

export default function IssueActivityFeed({
  issueId,
  assignees,
  columns,
  imageByUserId,
}: {
  issueId: number;
  assignees: Assignee[];
  columns: Column[];
  imageByUserId: Map<string, string | null>;
}) {
  const tIssue = useTranslations('issue');
  const t = useTranslations('issue.comments');
  const { data: session } = useSession();
  const { data: preferences } = useAccountPreferencesQuery();
  // Null until the person picks a shape on this issue, and then it wins over the
  // preference for as long as the issue stays open. Undefined while the preferences
  // are still loading: the entries wait for the saved shape rather than opening in
  // the default one and switching under the reader.
  const [viewHere, setViewHere] = useState<IssueActivityView | null>(null);
  const view = viewHere ?? preferences?.issueActivityView;

  const user = session?.user ?? null;
  const composer: ComposerContext = {
    issueId,
    assignees,
    authorName: user?.name || user?.email || t('you'),
    authorImage: (user as { image?: string | null } | null)?.image ?? null,
  };

  return (
    <div className="mt-4 border-t pt-4">
      <h3 className="mb-4 text-xs font-medium text-muted-foreground">
        {tIssue('activityHeading')}
      </h3>

      <CommentComposer {...composer} />

      {view && (
        <Stack gap={4}>
          <Inline justify="end">
            <Segmented<IssueActivityView>
              label={tIssue('activityHeading')}
              value={view}
              onChange={setViewHere}
              options={[
                { value: 'flat', label: tIssue('feedFlat') },
                { value: 'grouped', label: tIssue('feedGrouped') },
              ]}
            />
          </Inline>
          {view === 'flat' ? (
            <IssueFeedList issueId={issueId} imageByUserId={imageByUserId} composer={composer} />
          ) : (
            <IssueGroupedFeed
              issueId={issueId}
              columns={columns}
              imageByUserId={imageByUserId}
              composer={composer}
            />
          )}
        </Stack>
      )}
    </div>
  );
}
