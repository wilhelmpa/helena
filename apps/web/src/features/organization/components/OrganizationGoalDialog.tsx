'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useDisplayName } from '@/context/displayName';
import Modal from '@/components/common/overlay/Modal';
import MarkdownEditor from '@/components/common/editor/MarkdownEditor';
import { Button } from '@/components/ui/button';
import type {
  OrganizationDepartment,
  OrganizationGoal,
  OrganizationGoalStatus,
  OrganizationProject,
} from '@/lib/api/endpoints/organization';
import { useCreateGoal } from '../services/organization.service';
import { Box, Inline } from '@/design-system';
import GoalPropertyPills from './GoalPropertyPills';

// "Neues Ziel" of Helena (goals above the projects) in the create dialog every new thing
// uses (owner 28.09.: like "Neue Aufgabe"): a large title, the description, then one row of
// pills — status, the goal it serves, the department, the project, the target date.
export default function OrganizationGoalDialog({
  teamId,
  goals,
  departments,
  projects,
  onClose,
}: {
  teamId: number;
  goals: OrganizationGoal[];
  departments: OrganizationDepartment[];
  projects: OrganizationProject[];
  onClose: () => void;
}) {
  const t = useTranslations('organization');
  const appName = useDisplayName();
  const tCommon = useTranslations('common');
  const create = useCreateGoal(teamId);
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<OrganizationGoalStatus>('planned');
  const [parentGoalId, setParentGoalId] = useState<number | null>(null);
  const [departmentId, setDepartmentId] = useState<number | null>(null);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [targetDate, setTargetDate] = useState<string | null>(null);

  const submit = () => {
    const name = title.trim();
    if (!name || create.isPending) return;
    create.mutate(
      {
        title: name,
        description: description.trim(),
        status,
        parentGoalId,
        departmentId,
        projectId,
        targetDate,
      },
      { onSuccess: onClose },
    );
  };

  return (
    <Modal
      title={t('goals.new')}
      scope={appName.toLocaleUpperCase()}
      onClose={onClose}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        titleRef.current?.focus();
      }}
      wide
      createLayout
      className="new-issue-sheet"
    >
      <div className="flex min-h-0 flex-col">
        <input
          ref={titleRef}
          dir={title ? 'auto' : undefined}
          className="new-issue-title w-full min-w-0 bg-transparent outline-none"
          placeholder={t('goals.titlePlaceholder')}
          value={title}
          maxLength={160}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <Box marginTop={3}>
          <MarkdownEditor
            className="min-h-24 overflow-y-auto"
            defaultValue=""
            placeholder={t('goals.descriptionPlaceholder')}
            onChange={setDescription}
          />
        </Box>
        <Box marginTop={2}>
          <GoalPropertyPills
            value={{ status, parentGoalId, departmentId, projectId, targetDate }}
            goalId={null}
            goals={goals}
            departments={departments}
            projects={projects}
            onChange={(patch) => {
              if (patch.status !== undefined) setStatus(patch.status);
              if (patch.parentGoalId !== undefined) setParentGoalId(patch.parentGoalId);
              if (patch.departmentId !== undefined) setDepartmentId(patch.departmentId);
              if (patch.projectId !== undefined) setProjectId(patch.projectId);
              if (patch.targetDate !== undefined) setTargetDate(patch.targetDate);
            }}
          />
        </Box>
        <Inline
          gap={2}
          marginTop={5}
          justify="end"
          className="new-issue-footer flex-nowrap border-t"
        >
          <Button variant="ghost" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button disabled={!title.trim() || create.isPending} onClick={submit}>
            {t('goals.create')}
          </Button>
        </Inline>
      </div>
    </Modal>
  );
}
