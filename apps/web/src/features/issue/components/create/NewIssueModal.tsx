import { useEffect, useMemo, useRef, useState } from 'react';
import { type Editor } from '@tiptap/react';
import { MoreHorizontal } from 'lucide-react';
import type { IssueTemplate } from '@/lib/api/endpoints/issueTemplates';
import type { Project, ProjectDetail } from '@/lib/api/endpoints/projects';
import type { CycleRef, GoalRef, Issue, IssueFieldValueInput } from '@/lib/api/endpoints/issues';
import { type NewIssueDefaults } from '@/utils/project';
import { parseDate } from '@/utils/dates';
import { cn } from '@/lib/utils';
import { useSession } from '@/lib/auth-client';
import { useCreateIssue, useSetFieldValue, useUpdateIssue } from '@/services/issues.service';
import { fieldDefsForType } from '../../utils/fieldDefs';
import { useFileDragZone } from '@/hooks/useFileDragZone';
import { useFilePaste } from '../../hooks/useFilePaste';
import { useNewIssueAttachments } from '../../hooks/useNewIssueAttachments';
import {
  attachmentHtml,
  removeEmbed,
  replaceEmbed,
  stripEmbed,
  type Embeddable,
} from '@/components/common/editor/attachmentEmbed';
import { DESCRIPTION_SECTION, OTHER_SECTION, fieldSectionId } from '../../utils/bodySections';
import { hasFieldValue } from '../../utils/fieldValues';
import EstimatePill from '../fields/EstimatePill';
import IssueCustomFieldPill from '../fields/IssueCustomFieldPill';
import NewIssueAttachButton from './NewIssueAttachButton';
import NewIssueAttachmentStrip from './NewIssueAttachmentStrip';
import NewIssueDropOverlay from './NewIssueDropOverlay';
import NewIssueTemplatePill from './NewIssueTemplatePill';
import Modal from '@/components/common/overlay/Modal';
import NewIssueBody from './NewIssueBody';
import AssigneeSelect from '@/components/common/fields/AssigneeSelect';
import DatePill from '@/components/common/fields/DatePill';
import DelegateSelect from '../fields/DelegateSelect';
import LabelsSelect from '@/components/common/fields/LabelsSelect';
import PrioritySelect from '@/components/common/fields/PrioritySelect';
import StatusSelect from '@/components/common/fields/StatusSelect';
import TypeSelect from '@/components/common/fields/TypeSelect';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Pill } from '@/components/common/fields/Pill';
import GoalSelect from '../fields/GoalSelect';
import { useGoalOptionsQuery } from '@/services/goalOptions.service';
import CycleSelect from '../fields/CycleSelect';
import AreaSelect from '../fields/AreaSelect';
import { useTranslations } from 'next-intl';
import { useAiAgentsQuery } from '@/services/aiAgents.service';
import PopoverPick from '@/components/common/fields/PopoverPick';

export default function NewIssueModal({
  project,
  projects,
  onProjectChange,
  defaults,
  crumb,
  onClose,
  onCreated,
}: {
  project: ProjectDetail;
  projects?: Project[];
  onProjectChange?: (key: string) => void;
  defaults: NewIssueDefaults;
  // What the issue is being created for, named in the header after the title
  // ("Subtask of ISS-12", "Blocked by ISS-12").
  crumb?: string;
  onClose: () => void;
  onCreated: (created: Issue, keepOpen: boolean) => void;
}) {
  const t = useTranslations('issue.create');
  const tFields = useTranslations('issue.fields');
  const [title, setTitle] = useState(defaults.title ?? '');
  const [description, setDescription] = useState(defaults.description ?? '');
  const [columnId, setColumnId] = useState(defaults.columnId ?? project.columns[0]?.id ?? 0);
  const [typeId, setTypeId] = useState<number | null>(
    defaults.typeId === undefined
      ? (project.issueTypes.find((t) => t.isDefault)?.id ?? null)
      : defaults.typeId,
  );
  // An initiative comes from the board the issue is created on (an old project goal); the
  // task's "Ziel" is picked here as a goal, named by id and shown from the goal list.
  const initiativeId = defaults.initiativeId ?? null;
  const [goalId, setGoalId] = useState<number | null>(defaults.goalId ?? null);
  const [pickedGoal, setPickedGoal] = useState<GoalRef | null>(null);
  const goalOptions = useGoalOptionsQuery(project.project.key).data;
  const goal =
    goalId == null
      ? null
      : pickedGoal?.id === goalId
        ? pickedGoal
        : (goalOptions?.find((option) => option.id === goalId) ?? null);
  // A default cycle that is not among the planned ones has finished, and nothing new
  // is planned into it — the issue is created without a cycle instead.
  const [cycle, setCycle] = useState<CycleRef | null>(
    () => project.plannedCycles.find((c) => c.id === defaults.cycleId) ?? null,
  );
  const [folderId, setFolderId] = useState<number | null>(defaults.folderId ?? null);
  const { data: session } = useSession();
  // Assignee defaults to the creating user unless the caller set one explicitly
  // (defaults.assigneeUserId is null for the "No assignee" board group).
  const [assigneeUserId, setAssigneeUserId] = useState<string | null>(() => {
    if (defaults.assigneeUserId !== undefined) return defaults.assigneeUserId;
    const userId = session?.user.id;
    return userId != null &&
      project.assignees.some((a) => a.kind === 'member' && a.userId === userId)
      ? userId
      : null;
  });
  const [delegateUserId, setDelegateUserId] = useState<string | null>(
    defaults.delegateUserId ?? null,
  );
  const [priority, setPriority] = useState(defaults.priority ?? '');
  const [estimatePoints, setEstimatePoints] = useState<number | null>(null);
  const [estimateMinutes, setEstimateMinutes] = useState<number | null>(null);
  const [startDate, setStartDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [labelIds, setLabelIds] = useState<number[]>(defaults.labelIds ?? []);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [createMore, setCreateMore] = useState(false);
  const fullscreen = false;
  const agents = useAiAgentsQuery(project.project.teamId, project.project.id).data ?? [];
  const delegate = project.assignees.find((a) => a.userId === delegateUserId);
  const runtimeAgent = agents.find((a) => a.userId === delegateUserId);
  const runtimeName =
    runtimeAgent?.runtimePolicy.runtime === 'claude'
      ? 'Claude Code'
      : runtimeAgent?.runtimePolicy.runtime === 'codex'
        ? 'Codex'
        : 'Hermes';
  const execution = runtimeAgent?.model ? `${runtimeName} · ${runtimeAgent.model}` : runtimeName;

  // Custom fields for the selected type (project-wide + type-scoped), off the
  // scaffold every member already loads. Fields flagged "show in main info" get their
  // own body section; the rest are added on demand from the "…" menu.
  const fieldDefs = useMemo(
    () => fieldDefsForType(project.customFields, typeId),
    [project.customFields, typeId],
  );
  // A member field the dialog was opened with (the board grouped by it) starts
  // filled in, and shows as a property row so it is visible before saving.
  const [activeFieldIds, setActiveFieldIds] = useState<number[]>(() =>
    (defaults.fieldValues ?? []).map((f) => f.fieldId),
  );
  const [fieldValues, setFieldValues] = useState<Record<number, IssueFieldValueInput>>(() =>
    Object.fromEntries((defaults.fieldValues ?? []).map((f) => [f.fieldId, { value: f.userId }])),
  );
  const [justAddedId, setJustAddedId] = useState<number | null>(null);
  // The template applied last, named on its pill, and how many times one has been
  // applied. Every apply remounts the body: its editors read their markdown once,
  // when they are created, so applying the same template twice has to remount too.
  const [template, setTemplate] = useState<IssueTemplate | null>(null);
  const [applyCount, setApplyCount] = useState(0);

  const createIssue = useCreateIssue();
  const updateIssue = useUpdateIssue(project.project.key);
  const setFieldValueMutation = useSetFieldValue(project.project.key);
  const attachments = useNewIssueAttachments();

  // The description editor instance, so a file dropped or pasted anywhere on the
  // modal (not just onto the editor box) can be inserted at the cursor.
  const [descEditor, setDescEditor] = useState<Editor | null>(null);

  // The markdown editors of the body custom fields, so an attachment removed
  // from the strip takes its embeds with it wherever they were inserted.
  const fieldEditors = useRef(new Map<number, Editor>());

  // Which of the body sections is open, so an attachment lands in the editor the
  // user is looking at.
  const [bodySection, setBodySection] = useState(DESCRIPTION_SECTION);

  function activeBodyEditor(): Editor | null {
    if (bodySection === DESCRIPTION_SECTION) return descEditor;
    const fieldId = fieldSectionId(bodySection);
    return fieldId === null ? null : (fieldEditors.current.get(fieldId) ?? null);
  }

  function insertIntoBody(a: Embeddable) {
    activeBodyEditor()?.chain().focus().insertContent(attachmentHtml(a)).run();
  }

  function removeAttachment(id: number) {
    const item = attachments.remove(id);
    if (!item) return;
    if (descEditor) removeEmbed(descEditor, item.url);
    for (const editor of fieldEditors.current.values()) removeEmbed(editor, item.url);
  }

  // The annotated image replaces the file it was drawn on, so wherever that file
  // was already inserted now shows the annotated one.
  function annotateAttachment(id: number, file: File) {
    const urls = attachments.replace(id, file);
    if (!urls) return;
    if (descEditor) replaceEmbed(descEditor, urls.from, urls.to);
    for (const editor of fieldEditors.current.values()) replaceEmbed(editor, urls.from, urls.to);
  }

  function insertFilesIntoBody(files: FileList) {
    const editor = activeBodyEditor();
    // No editor on screen: still attach the files, they can be inserted later.
    if (!editor) {
      attachments.attach(files);
      return;
    }
    let pos = editor.state.selection.to;
    void (async () => {
      for (const file of Array.from(files)) {
        const a = await attachments.uploadFile(file).catch(() => null);
        if (!a) continue;
        editor.chain().insertContentAt(pos, attachmentHtml(a)).focus().run();
        pos = editor.state.selection.to;
      }
    })();
  }

  const { draggedFiles, dragHandlers } = useFileDragZone(insertFilesIntoBody);

  useFilePaste(insertFilesIntoBody);

  const [addFieldOpen, setAddFieldOpen] = useState(false);

  // Drop shown fields that no longer apply to the selected type. Nothing is shown
  // by default — the user adds fields from the "…" menu.
  useEffect(() => {
    const valid = new Set(fieldDefs.filter((d) => !d.showInBody).map((d) => d.id));
    setActiveFieldIds((prev) => prev.filter((id) => valid.has(id)));
  }, [fieldDefs]);

  // The calendars grey out days that would put one date on the wrong side of the
  // other: the start no later than the due date, the due date no earlier than the
  // start. Equal dates are allowed.
  const latestStart = parseDate(dueDate);
  const earliestDue = parseDate(startDate);

  const errorMessage = error ?? attachments.error;
  const bodyDefs = fieldDefs.filter((d) => d.showInBody);
  const propertyDefs = fieldDefs.filter((d) => !d.showInBody);
  const activeDefs = propertyDefs.filter((d) => activeFieldIds.includes(d.id));
  const availableDefs = propertyDefs.filter((d) => !activeFieldIds.includes(d.id));

  function toggleLabel(id: number) {
    setLabelIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  function setFieldValue(id: number, patch: IssueFieldValueInput) {
    setFieldValues((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  // Fills the dialog in from a template. A property the template leaves unset
  // presets nothing, so what the dialog already holds stays.
  function applyTemplate(next: IssueTemplate) {
    setTemplate(next);
    setApplyCount((n) => n + 1);
    if (next.titleTemplate) setTitle(next.titleTemplate);
    setDescription(next.descriptionTemplate);
    if (next.columnId != null) setColumnId(next.columnId);
    if (next.typeId != null) setTypeId(next.typeId);
    if (next.priority != null) setPriority(next.priority);
    if (next.assigneeUserId != null) setAssigneeUserId(next.assigneeUserId);
    if (next.labelIds.length > 0) setLabelIds(next.labelIds);
  }

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const created = await createIssue.mutateAsync({
        projectKey: project.project.key,
        input: {
          title: title.trim(),
          description: description.trim() || undefined,
          columnId,
          parentId: defaults.parentId ?? null,
          typeId,
          initiativeId,
          goalId,
          cycleId: cycle?.id ?? null,
          folderId,
          assigneeUserId,
          delegateUserId,
          priority: priority || null,
          estimatePoints,
          estimateMinutes,
          startDate: startDate || null,
          dueDate: dueDate || null,
          labelIds,
        },
      });
      // Upload the pending files, then point every embed at its stored URL
      // instead of the local blob: one.
      const storedUrls = await attachments.uploadAll(created.id);
      const rewrite = (markdown: string) => {
        let out = markdown;
        for (const [blobUrl, url] of storedUrls) {
          out = url ? out.replaceAll(blobUrl, url) : stripEmbed(out, blobUrl);
        }
        return out;
      };

      const body = rewrite(description);
      if (body !== description) {
        await updateIssue.mutateAsync({ id: created.id, patch: { description: body.trim() } });
      }

      // Set custom field values on the freshly created issue. Body fields are
      // always applicable; property fields only if the user added them.
      for (const def of fieldDefs) {
        if (!def.showInBody && !activeFieldIds.includes(def.id)) continue;
        const v = fieldValues[def.id];
        if (!hasFieldValue(v)) continue;
        const value = typeof v.value === 'string' ? { ...v, value: rewrite(v.value) } : v;
        await setFieldValueMutation.mutateAsync({ issueId: created.id, fieldId: def.id, value });
      }
      onCreated(created, createMore);
      if (createMore) {
        setTitle('');
        setDescription('');
        setApplyCount((n) => n + 1);
        for (const item of attachments.pending) attachments.remove(item.id);
        titleRef.current?.focus();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  // Enter creates the issue when the caret is in the title, or when no element has
  // focus: Radix then keeps focus on the dialog element itself. The handler ignores
  // focus inside the body editors or a nested dialog.
  const titleRef = useRef<HTMLInputElement>(null);
  // No dependency array: the handler reads the title and the saving flag of the
  // current render, so React registers it again after every render.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Enter' || e.shiftKey || e.altKey || e.isComposing) return;
      if (e.metaKey || e.ctrlKey) {
        const dialog = titleRef.current?.closest('[role="dialog"]');
        if (!dialog?.contains(e.target as Node)) return;
        e.preventDefault();
        if (!saving && title.trim()) void submit();
        return;
      }
      const active = document.activeElement;
      const isTitleFocused = active === titleRef.current;
      const isDialogFocused =
        active instanceof HTMLElement &&
        active.getAttribute('role') === 'dialog' &&
        active.contains(titleRef.current);
      if (!isTitleFocused && !isDialogFocused) return;
      e.preventDefault();
      if (saving || !title.trim()) return;
      void submit();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  });

  function requestClose() {
    const hasContent =
      title.trim() ||
      description.trim() ||
      attachments.pending.length > 0 ||
      Object.values(fieldValues).some(hasFieldValue);
    if (!hasContent || window.confirm('Eingaben verwerfen?')) onClose();
  }

  return (
    <Modal
      title={t('title')}
      crumb={crumb}
      scope={project.project.name.toUpperCase()}
      onClose={requestClose}
      // The template pill comes before the title in the DOM, so the title has to
      // claim the focus itself.
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        titleRef.current?.focus();
      }}
      wide
      fullscreen={fullscreen}
      createLayout
      className="new-issue-sheet"
    >
      <div
        className={cn('flex min-h-0 flex-col', fullscreen && 'flex-1 overflow-hidden')}
        {...dragHandlers}
      >
        {draggedFiles !== null && <NewIssueDropOverlay count={draggedFiles} />}
        <input
          ref={titleRef}
          // `auto` once there is something to read, so a title keeps the script it
          // was typed in. While the field is empty there is nothing to read from,
          // and it would fall back to left-to-right and strand the placeholder.
          dir={title ? 'auto' : undefined}
          className="new-issue-title w-full min-w-0 bg-transparent text-2xl font-medium tracking-[-.03em] outline-none"
          placeholder={t('titlePlaceholder')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <div className={cn('flex min-h-0 flex-col overflow-hidden', fullscreen && 'flex-1')}>
          <NewIssueBody
            key={applyCount}
            section={bodySection}
            onSectionChange={setBodySection}
            fullscreen={fullscreen}
            description={description}
            onDescriptionChange={setDescription}
            onDescriptionReady={setDescEditor}
            bodyDefs={bodyDefs}
            fieldValues={fieldValues}
            assignees={project.assignees}
            onFieldValue={setFieldValue}
            onFieldEditorReady={(id, editor) => {
              if (editor) fieldEditors.current.set(id, editor);
              else fieldEditors.current.delete(id);
            }}
            uploadFile={attachments.uploadFile}
          />
        </div>

        {delegate && (
          <p className="new-issue-running mt-2 flex items-center gap-2 text-xs">
            <span className="new-issue-running-dot rounded-full" />
            {'Startet sofort bei'} {delegate.name} · {execution}
          </p>
        )}

        <div className="new-issue-pills mt-2 flex flex-wrap items-center gap-2">
          {projects && onProjectChange ? (
            <PopoverPick
              trigger={
                <Pill active>
                  <span className="new-issue-project-dot rounded-full" />
                  {project.project.key}
                </Pill>
              }
              inputPlaceholder={t('findProject')}
              items={projects.map((item) => ({
                key: item.key,
                search: `${item.key} ${item.name}`,
                icon: <span className="new-issue-project-dot rounded-full" />,
                label: item.name,
                selected: item.key === project.project.key,
                onSelect: () => {
                  if (item.key === project.project.key) return;
                  if (
                    (title.trim() || description.trim()) &&
                    !window.confirm(t('discardAndSwitch'))
                  )
                    return;
                  onProjectChange(item.key);
                },
              }))}
            />
          ) : (
            <Pill active>
              <span className="new-issue-project-dot rounded-full" />
              {project.project.key}
            </Pill>
          )}
          <StatusSelect columns={project.columns} value={columnId} onChange={setColumnId} />

          <PrioritySelect value={priority} onChange={setPriority} />

          {project.assignees.some((a) => a.kind === 'member') && (
            <AssigneeSelect
              assignees={project.assignees}
              value={assigneeUserId}
              onChange={setAssigneeUserId}
              placeholder={tFields('assignee')}
            />
          )}

          {project.assignees.some((a) => a.kind === 'agent') && (
            <DelegateSelect
              assignees={project.assignees}
              value={delegateUserId}
              onChange={setDelegateUserId}
              placeholder={tFields('delegate')}
            />
          )}

          <GoalSelect
            projectKey={project.project.key}
            projectId={project.project.id}
            teamId={project.project.teamId}
            value={goal}
            onChange={(next) => {
              setGoalId(next?.id ?? null);
              setPickedGoal(next);
            }}
          />

          <DatePill
            value={dueDate || null}
            placeholder={t('due')}
            onChange={(v) => setDueDate(v ?? '')}
            disabled={earliestDue ? { before: earliestDue } : undefined}
          />

          <LabelsSelect
            labels={project.labels}
            groups={project.labelGroups}
            value={labelIds}
            onToggle={toggleLabel}
            placeholder="+ Label"
          />

          <Pill onClick={() => setMoreOpen((open) => !open)}>
            {'Mehr'} <MoreHorizontal />
          </Pill>
        </div>

        {moreOpen && (
          <div className="new-issue-pills mt-2 flex flex-wrap items-center gap-2">
            <NewIssueAttachButton onPick={attachments.attach} />
            {project.issueTemplates.length > 0 && (
              <NewIssueTemplatePill
                templates={project.issueTemplates}
                applied={template}
                onApply={applyTemplate}
              />
            )}
            {project.issueTypes.length > 0 && (
              <TypeSelect issueTypes={project.issueTypes} value={typeId} onChange={setTypeId} />
            )}
            {project.project.cyclesEnabled && (
              <CycleSelect projectKey={project.project.key} value={cycle} onChange={setCycle} />
            )}
            {project.areas.length > 0 && (
              <AreaSelect areas={project.areas} value={folderId} onChange={setFolderId} />
            )}
            {project.project.pointsEstimateEnabled && (
              <EstimatePill kind="points" value={estimatePoints} onChange={setEstimatePoints} />
            )}

            {project.project.timeEstimateEnabled && (
              <EstimatePill kind="time" value={estimateMinutes} onChange={setEstimateMinutes} />
            )}

            <DatePill
              value={startDate || null}
              placeholder={tFields('startDate')}
              onChange={(v) => setStartDate(v ?? '')}
              disabled={latestStart ? { after: latestStart } : undefined}
            />

            {activeDefs.map((def) => (
              <IssueCustomFieldPill
                key={def.id}
                def={def}
                value={fieldValues[def.id]}
                assignees={project.assignees}
                defaultOpen={def.id === justAddedId}
                onChange={(v) => setFieldValue(def.id, v)}
              />
            ))}

            {availableDefs.length > 0 && (
              <Popover open={addFieldOpen} onOpenChange={setAddFieldOpen}>
                <PopoverTrigger asChild>
                  <Pill>
                    <MoreHorizontal />
                  </Pill>
                </PopoverTrigger>
                <PopoverContent className="w-56 p-0" align="start">
                  <Command>
                    <CommandInput placeholder={t('addFieldPlaceholder')} />
                    <CommandList>
                      <CommandEmpty>{t('noFields')}</CommandEmpty>
                      <CommandGroup>
                        {availableDefs.map((def) => (
                          <CommandItem
                            key={def.id}
                            value={def.name}
                            onSelect={() => {
                              setActiveFieldIds((ids) => [...ids, def.id]);
                              setJustAddedId(def.id);
                              setAddFieldOpen(false);
                            }}
                          >
                            <span className="flex-1">{def.name}</span>
                            <span className="text-xs text-muted-foreground">{def.fieldType}</span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            )}
          </div>
        )}

        {errorMessage && <p className="mt-3 text-xs text-destructive">{errorMessage}</p>}

        <div className="new-issue-footer mt-5 flex flex-nowrap items-center gap-2 border-t">
          <NewIssueAttachmentStrip
            items={attachments.pending}
            onInsert={bodySection === OTHER_SECTION ? undefined : insertIntoBody}
            onAnnotate={annotateAttachment}
            onRemove={removeAttachment}
          />
          <label className="new-issue-more-label flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={createMore}
              onChange={(e) => setCreateMore(e.target.checked)}
            />
            {t('createMore')}
          </label>
          <span className="new-issue-shortcut ms-auto hidden font-mono sm:inline">{'⌘ ENTER'}</span>
          <Button
            className="new-issue-submit ms-auto h-9 shrink-0 rounded-full px-4 sm:ms-0"
            disabled={saving || !title.trim()}
            onClick={submit}
          >
            {t('submit')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
