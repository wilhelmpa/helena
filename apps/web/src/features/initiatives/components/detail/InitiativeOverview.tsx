'use client';

import { useTranslations } from 'next-intl';
import type { Initiative } from '@/lib/api/endpoints/initiatives';
import type { ProjectDetail } from '@/lib/api/endpoints/projects';
import MarkdownEditor from '@/components/common/editor/MarkdownEditor';
import InitiativeAttachments from './InitiativeAttachments';
import InitiativeHeader from './InitiativeHeader';

// The initiative's own text: its title, its properties and its description as
// markdown, with its files beside them. The numbers and the activity feed are the
// Progress tab.
export default function InitiativeOverview({
  initiative,
  project,
}: {
  initiative: Initiative;
  project: ProjectDetail;
}) {
  const t = useTranslations('initiatives');
  const hasDescription = initiative.description.trim().length > 0;

  return (
    // A container query, not a viewport one: the sidebar takes width off this
    // column, so the viewport says nothing about whether the two fit side by side.
    <div className="@container w-full p-4">
      <div className="flex flex-col gap-6 @4xl:flex-row">
        <div className="max-w-3xl min-w-0 flex-1">
          <InitiativeHeader initiative={initiative} project={project} />
          {hasDescription ? (
            <MarkdownEditor
              className="mt-4 text-sm"
              // The editor reads its content once, at mount: a save has to remount it.
              key={initiative.updatedAt}
              defaultValue={initiative.description}
              editable={false}
            />
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">{t('noDescription')}</p>
          )}
        </div>
        <aside className="flex flex-col gap-4 @4xl:ms-auto @4xl:w-88 @4xl:shrink-0">
          <InitiativeAttachments initiativeId={initiative.id} />
        </aside>
      </div>
    </div>
  );
}
