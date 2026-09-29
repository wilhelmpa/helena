'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowLeft, Trash2 } from 'lucide-react';
import MarkdownEditor from '@/components/common/editor/MarkdownEditor';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import {
  ActionMenu,
  DetailGroup,
  DetailView,
  IconButton,
  Inline,
  Stack,
  Text,
} from '@/design-system';
import type {
  OrganizationDepartment,
  OrganizationGoal,
  OrganizationProject,
} from '@/lib/api/endpoints/organization';
import { useDeleteGoal, useUpdateGoal } from '../services/organization.service';
import GoalPropertyPills from './GoalPropertyPills';
import OrganizationGoalLadder from './OrganizationGoalLadder';
import OrganizationGoalProgress from './OrganizationGoalProgress';

// The right column of Helena › Ziele (owner, 28.09., O11): one goal — its title and its
// description to edit in place, its properties as chips that save at once, its ladder
// ("Warum": what it serves and what serves it), and its work (the linked tasks, the agents
// on them, their notes and proposals). No form to open and no save button.
export default function OrganizationGoalDetail({
  teamId,
  goal,
  goals,
  departments,
  projects,
  onSelect,
  onBack,
  onDeleted,
}: {
  teamId: number;
  goal: OrganizationGoal;
  goals: OrganizationGoal[];
  departments: OrganizationDepartment[];
  projects: OrganizationProject[];
  onSelect: (goalId: number) => void;
  // On a phone the detail replaces the list: the way back to it.
  onBack: () => void;
  onDeleted: () => void;
}) {
  const t = useTranslations('organization');
  const update = useUpdateGoal(teamId);
  const remove = useDeleteGoal(teamId);
  const [deleting, setDeleting] = useState(false);
  const save = (input: Parameters<typeof update.mutate>[0]['input']) =>
    update.mutate({ id: goal.id, input });

  return (
    <DetailView className="ds-goal-detail">
      <Inline gap={2} justify="between">
        <IconButton label={t('goals.back')} className="ds-goal-back" onClick={onBack}>
          <ArrowLeft size={16} />
        </IconButton>
        <span className="ds-grow" />
        <ActionMenu
          label={t('goals.actions', { title: goal.title })}
          items={[
            {
              id: 'delete',
              label: t('actions.delete'),
              icon: <Trash2 size={14} />,
              danger: true,
              onSelect: () => setDeleting(true),
            },
          ]}
        />
      </Inline>
      <input
        key={`title-${goal.id}-${goal.updatedAt}`}
        className="ds-goal-detail-title"
        aria-label={t('fields.title')}
        defaultValue={goal.title}
        maxLength={160}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
        onBlur={(event) => {
          const title = event.target.value.trim();
          if (title && title !== goal.title) save({ title });
          else event.target.value = goal.title;
        }}
      />
      <GoalPropertyPills
        value={{
          status: goal.status,
          parentGoalId: goal.parentGoalId,
          departmentId: goal.departmentId,
          projectId: goal.projectId,
          targetDate: goal.targetDate,
        }}
        goalId={goal.id}
        goals={goals}
        departments={departments}
        projects={projects}
        onChange={(patch) => save(patch)}
      />
      <MarkdownEditor
        key={`description-${goal.id}-${goal.updatedAt}`}
        className="ds-goal-description"
        defaultValue={goal.description}
        placeholder={t('goals.descriptionPlaceholder')}
        onBlur={(markdown) => {
          if (markdown !== goal.description) save({ description: markdown });
        }}
      />
      <DetailGroup title={t('goals.why')}>
        <OrganizationGoalLadder goal={goal} goals={goals} onSelect={onSelect} />
      </DetailGroup>
      <DetailGroup title={t('goals.work')}>
        <OrganizationGoalProgress teamId={teamId} goal={goal} />
      </DetailGroup>
      {update.isError && (
        <Text as="p" size="xs" tone="danger">
          {t('goals.saveFailed')}
        </Text>
      )}
      {deleting && (
        <ConfirmDialog
          title={t('goals.deleteTitle', { title: goal.title })}
          confirmLabel={t('actions.delete')}
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            await remove.mutateAsync(goal.id);
            setDeleting(false);
            onDeleted();
          }}
        >
          <Stack gap={2}>
            <Text as="p" tone="muted">
              {t('goals.deleteBody')}
            </Text>
          </Stack>
        </ConfirmDialog>
      )}
    </DetailView>
  );
}
