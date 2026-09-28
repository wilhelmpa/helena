import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { Initiative, InitiativeStatus } from '@/lib/api/endpoints/initiatives';
import { initiativePath } from '@/utils/paths';
import { parseDate } from '@/utils/dates';
import { useCreateInitiative, useUpdateInitiative } from '@/services/initiatives.service';
import { useProjectQuery } from '@/services/projects.service';
import Modal, { useModalFullscreen } from './Modal';
import AssigneeSelect from '@/components/common/fields/AssigneeSelect';
import DatePill from '@/components/common/fields/DatePill';
import LabelsSelect from '@/components/common/fields/LabelsSelect';
import PrioritySelect from '@/components/common/fields/PrioritySelect';
import InitiativeStatusSelect from '@/components/common/fields/InitiativeStatusSelect';
import MarkdownEditor from '@/components/common/editor/MarkdownEditor';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { MoreHorizontal } from 'lucide-react';
import { Pill } from '@/components/common/fields/Pill';

// An initiative's fields ("Ziel"), laid out as a new task is: title, description, then
// the few properties that matter as pills and the rest under "Mehr". With `initiative` it edits that one, otherwise it
// creates one and — without onCreated — navigates to it.
export default function InitiativeDialog({
  projectKey,
  initiative,
  onClose,
  onCreated,
}: {
  projectKey: string;
  initiative?: Initiative;
  onClose: () => void;
  onCreated?: (id: number) => void;
}) {
  const t = useTranslations('initiatives');
  const tCommon = useTranslations('common');
  // Already in the cache: the Shell loads it for the project the dialog opens in.
  const { data: project } = useProjectQuery(projectKey);
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(initiative?.title ?? '');
  const [description, setDescription] = useState(initiative?.description ?? '');
  const [status, setStatus] = useState<InitiativeStatus>(initiative?.status ?? 'planned');
  const [ownerUserId, setOwnerUserId] = useState<string | null>(initiative?.ownerUserId ?? null);
  const [priority, setPriority] = useState(initiative?.priority ?? '');
  const [startDate, setStartDate] = useState<string | null>(initiative?.startDate ?? null);
  const [targetDate, setTargetDate] = useState<string | null>(initiative?.targetDate ?? null);
  const [labelIds, setLabelIds] = useState<number[]>(initiative?.labelIds ?? []);
  const { fullscreen, onToggleFullscreen } = useModalFullscreen();
  const create = useCreateInitiative(projectKey);
  const update = useUpdateInitiative(projectKey);
  const router = useRouter();

  const saving = create.isPending || update.isPending;
  const busyLabel = initiative ? tCommon('saving') : t('form.creating');
  const idleLabel = initiative ? t('form.save') : t('form.create');
  const submitLabel = saving ? busyLabel : idleLabel;

  // The calendars grey out days that would put one date on the wrong side of the
  // other. Equal dates are allowed.
  const latestStart = parseDate(targetDate);
  const earliestTarget = parseDate(startDate);

  const toggleLabel = (labelId: number) =>
    setLabelIds((ids) =>
      ids.includes(labelId) ? ids.filter((id) => id !== labelId) : [...ids, labelId],
    );

  const submit = async () => {
    const name = title.trim();
    if (!name) return;
    const fields = {
      title: name,
      description: description.trim(),
      status,
      ownerUserId,
      priority: priority || null,
      startDate,
      targetDate,
      labelIds,
    };
    if (initiative) {
      await update.mutateAsync({ id: initiative.id, patch: fields });
      onClose();
      return;
    }
    const created = await create.mutateAsync(fields);
    onClose();
    if (onCreated) onCreated(created.id);
    else router.push(initiativePath(projectKey, created.id));
  };

  // The owner decided (28.09.): few fields up front — title, what for, status, owner and
  // target — and the rest under "Mehr", like a new task.
  const [moreOpen, setMoreOpen] = useState(
    !!(initiative?.priority || initiative?.startDate || initiative?.labelIds.length),
  );

  return (
    <Modal
      title={initiative ? t('form.editTitle') : t('newInitiative')}
      scope={project?.project.name.toUpperCase() ?? projectKey}
      onClose={onClose}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        titleRef.current?.focus();
      }}
      wide
      fullscreen={fullscreen}
      onToggleFullscreen={onToggleFullscreen}
      createLayout
      className="new-issue-sheet"
    >
      <div className={cn('flex min-h-0 flex-col', fullscreen && 'flex-1 overflow-hidden')}>
        <input
          ref={titleRef}
          // `auto` once there is something to read, so a title keeps the script it
          // was typed in.
          dir={title ? 'auto' : undefined}
          className="new-issue-title w-full min-w-0 bg-transparent text-2xl font-medium tracking-[-.03em] outline-none"
          placeholder={t('form.titlePlaceholder')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (title.trim() && !saving) void submit();
            }
          }}
        />
        <div className={cn('flex min-h-0 flex-col overflow-hidden', fullscreen && 'flex-1')}>
          <MarkdownEditor
            // In fullscreen the editor claims the leftover height; in compact it
            // grows with its content and scrolls once the dialog runs out of room.
            className={cn('mt-3 overflow-y-auto', fullscreen ? 'min-h-48 flex-1' : 'min-h-24')}
            defaultValue={initiative?.description ?? ''}
            placeholder={t('form.descriptionPlaceholder')}
            onChange={setDescription}
          />
        </div>

        <div className="new-issue-pills mt-2 flex flex-wrap items-center gap-2">
          <InitiativeStatusSelect value={status} onChange={setStatus} />
          {project?.assignees.some((a) => a.kind === 'member') && (
            <AssigneeSelect
              assignees={project.assignees}
              value={ownerUserId}
              onChange={setOwnerUserId}
              placeholder={t('noOwner')}
            />
          )}
          <DatePill
            value={targetDate}
            placeholder={t('targetDate')}
            onChange={setTargetDate}
            disabled={earliestTarget ? { before: earliestTarget } : undefined}
          />
          <Pill onClick={() => setMoreOpen((open) => !open)} aria-expanded={moreOpen}>
            {tCommon('more')} <MoreHorizontal />
          </Pill>
        </div>
        {moreOpen && (
          <div className="new-issue-pills mt-2 flex flex-wrap items-center gap-2">
            <PrioritySelect value={priority} onChange={setPriority} />
            <DatePill
              value={startDate}
              placeholder={t('startDate')}
              onChange={setStartDate}
              disabled={latestStart ? { after: latestStart } : undefined}
            />
            {project && project.labels.length > 0 && (
              <LabelsSelect
                labels={project.labels}
                groups={project.labelGroups}
                value={labelIds}
                onToggle={toggleLabel}
              />
            )}
          </div>
        )}

        <div className="new-issue-footer mt-5 flex flex-nowrap items-center justify-end gap-2 border-t">
          <Button variant="ghost" onClick={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button disabled={!title.trim() || saving} onClick={() => void submit()}>
            {submitLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
