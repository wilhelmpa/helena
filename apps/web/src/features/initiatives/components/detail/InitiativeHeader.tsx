'use client';

import { useTranslations } from 'next-intl';
import type { ProjectDetail } from '@/lib/api/endpoints/projects';
import type { Initiative, InitiativePatch } from '@/lib/api/endpoints/initiatives';
import { useUpdateInitiative } from '@/services/initiatives.service';
import { parseDate } from '@/utils/dates';
import AssigneeSelect from '@/components/common/fields/AssigneeSelect';
import DatePill from '@/components/common/fields/DatePill';
import LabelsSelect from '@/components/common/fields/LabelsSelect';
import PrioritySelect from '@/components/common/fields/PrioritySelect';
import InitiativeStatusSelect from '@/components/common/fields/InitiativeStatusSelect';
import HealthBadge from '../shared/HealthBadge';
import HealthInfoPopover from '../shared/HealthInfoPopover';
import ProgressBar from '@/components/common/ProgressBar';
import { Inline, Stack } from '@/design-system';

// The top of the initiative's overview: its title (the page's one 16px title) and
// its properties as pills that patch it inline, with its health and progress. The
// title and the description are edited from the Edit action in the header row.
export default function InitiativeHeader({
  initiative,
  project,
}: {
  initiative: Initiative;
  project: ProjectDetail;
}) {
  const t = useTranslations('initiatives');
  const update = useUpdateInitiative(project.project.key);
  // The calendars grey out days that would put one date on the wrong side of the
  // other. Equal dates are allowed.
  const latestStart = parseDate(initiative.targetDate);
  const earliestTarget = parseDate(initiative.startDate);

  const patch = (p: InitiativePatch) => update.mutate({ id: initiative.id, patch: p });

  const toggleLabel = (labelId: number) => {
    const next = initiative.labelIds.includes(labelId)
      ? initiative.labelIds.filter((id) => id !== labelId)
      : [...initiative.labelIds, labelId];
    patch({ labelIds: next });
  };

  return (
    <Stack gap={3}>
      <h1 className="text-base font-semibold" dir="auto">
        {initiative.title}
      </h1>
      <Inline gap={2} wrap>
        <InitiativeStatusSelect
          value={initiative.status}
          onChange={(status) => patch({ status })}
        />
        <AssigneeSelect
          assignees={project.assignees}
          value={initiative.ownerUserId}
          onChange={(ownerUserId) => patch({ ownerUserId })}
          placeholder={t('noOwner')}
        />
        <PrioritySelect
          value={initiative.priority ?? ''}
          onChange={(v) => patch({ priority: v || null })}
        />
        <DatePill
          value={initiative.startDate}
          placeholder={t('startDate')}
          onChange={(v) => patch({ startDate: v })}
          disabled={latestStart ? { after: latestStart } : undefined}
        />
        <DatePill
          value={initiative.targetDate}
          placeholder={t('targetDate')}
          onChange={(v) => patch({ targetDate: v })}
          disabled={earliestTarget ? { before: earliestTarget } : undefined}
        />
        <LabelsSelect
          labels={project.labels}
          groups={project.labelGroups}
          value={initiative.labelIds}
          onToggle={toggleLabel}
        />
        <span className="mx-1 hidden h-4 w-px bg-border sm:block" />
        <Inline gap={1}>
          <HealthInfoPopover />
          <HealthBadge health={initiative.health} />
        </Inline>
        <ProgressBar progress={initiative.progress} />
      </Inline>
    </Stack>
  );
}
