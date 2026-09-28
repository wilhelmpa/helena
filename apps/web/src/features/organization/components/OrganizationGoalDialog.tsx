'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Building2, CircleDot, FolderKanban, Target } from 'lucide-react';
import Modal from '@/components/common/overlay/Modal';
import MarkdownEditor from '@/components/common/editor/MarkdownEditor';
import DatePill from '@/components/common/fields/DatePill';
import PopoverPick from '@/components/common/fields/PopoverPick';
import { Pill } from '@/components/common/fields/Pill';
import { Button } from '@/components/ui/button';
import type {
  OrganizationDepartment,
  OrganizationGoal,
  OrganizationGoalStatus,
  OrganizationProject,
} from '@/lib/api/endpoints/organization';
import { useCreateGoal } from '../services/organization.service';
import { Inline } from '@/design-system';

const STATUSES: OrganizationGoalStatus[] = ['planned', 'active', 'achieved', 'paused'];

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

  const parent = goals.find((goal) => goal.id === parentGoalId);
  const department = departments.find((item) => item.id === departmentId);
  const project = projects.find((item) => item.id === projectId);
  const none = (selected: boolean, onSelect: () => void) => ({
    key: 'none',
    search: t('goals.none'),
    icon: null,
    label: t('goals.none'),
    selected,
    onSelect,
  });

  return (
    <Modal
      title={t('goals.new')}
      scope="HELENA"
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
        <MarkdownEditor
          className="mt-3 min-h-24 overflow-y-auto"
          defaultValue=""
          placeholder={t('goals.descriptionPlaceholder')}
          onChange={setDescription}
        />
        <Inline gap={2} marginTop={2} wrap className="new-issue-pills">
          <PopoverPick
            trigger={
              <Pill active>
                <CircleDot />
                {t(`statuses.${status}`)}
              </Pill>
            }
            inputPlaceholder={t('fields.status')}
            items={STATUSES.map((value) => ({
              key: value,
              search: t(`statuses.${value}`),
              icon: <CircleDot />,
              label: t(`statuses.${value}`),
              selected: value === status,
              onSelect: () => setStatus(value),
            }))}
          />
          {goals.length > 0 && (
            <PopoverPick
              trigger={
                <Pill active={parent != null}>
                  <Target />
                  {parent?.title ?? t('fields.parentGoal')}
                </Pill>
              }
              inputPlaceholder={t('fields.parentGoal')}
              contentClassName="w-72"
              items={[
                none(parentGoalId == null, () => setParentGoalId(null)),
                ...goals.map((goal) => ({
                  key: String(goal.id),
                  search: goal.title,
                  icon: <Target />,
                  label: goal.title,
                  selected: goal.id === parentGoalId,
                  onSelect: () => setParentGoalId(goal.id),
                })),
              ]}
            />
          )}
          {departments.length > 0 && (
            <PopoverPick
              trigger={
                <Pill active={department != null}>
                  <Building2 />
                  {department?.name ?? t('fields.department')}
                </Pill>
              }
              inputPlaceholder={t('fields.department')}
              items={[
                none(departmentId == null, () => setDepartmentId(null)),
                ...departments.map((item) => ({
                  key: String(item.id),
                  search: item.name,
                  icon: <Building2 />,
                  label: item.name,
                  selected: item.id === departmentId,
                  onSelect: () => setDepartmentId(item.id),
                })),
              ]}
            />
          )}
          {projects.length > 0 && (
            <PopoverPick
              trigger={
                <Pill active={project != null}>
                  <FolderKanban />
                  {project?.name ?? t('fields.project')}
                </Pill>
              }
              inputPlaceholder={t('fields.project')}
              items={[
                none(projectId == null, () => setProjectId(null)),
                ...projects.map((item) => ({
                  key: String(item.id),
                  search: `${item.key} ${item.name}`,
                  icon: <FolderKanban />,
                  label: item.name,
                  selected: item.id === projectId,
                  onSelect: () => setProjectId(item.id),
                })),
              ]}
            />
          )}
          <DatePill
            value={targetDate}
            placeholder={t('fields.targetDate')}
            onChange={setTargetDate}
          />
        </Inline>
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
