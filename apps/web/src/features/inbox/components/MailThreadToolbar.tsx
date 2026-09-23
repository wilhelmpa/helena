'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  Archive,
  ArrowLeft,
  Forward,
  FolderInput,
  ListPlus,
  Mail,
  MailOpen,
  NotebookPen,
  Reply,
  ReplyAll,
  Star,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { MailDraftMode, MailThread } from '@/lib/api/endpoints/mail';
import { useProjectsQuery } from '@/services/projects.service';
import { issuePath } from '@/utils/paths';
import { useCreateTaskFromMail, useSaveMailNote, useThreadAction } from '../services/mail.service';
import ProjectPickerDialog from './ProjectPickerDialog';

// The actions on the open thread. The letter in a title is its key in the inbox.
export default function MailThreadToolbar({
  thread,
  teamId,
  onBack,
  onDraft,
  onArchive,
  onMove,
  onRemoved,
}: {
  thread: MailThread;
  teamId: number;
  onBack: () => void;
  onDraft: (mode: MailDraftMode) => void;
  onArchive: () => void;
  onMove: () => void;
  onRemoved: () => void;
}) {
  const t = useTranslations('mail.actions');
  const router = useRouter();
  const action = useThreadAction(teamId);
  const createTask = useCreateTaskFromMail();
  const saveNote = useSaveMailNote();
  const [pickTaskProject, setPickTaskProject] = useState(false);
  const projects = (useProjectsQuery().data ?? []).filter((item) => item.teamId === teamId);
  const unread = thread.messages.some((message) => !message.seen);
  const flagged = thread.messages.some((message) => message.flagged);

  const task = (projectId?: number) =>
    createTask.mutate(
      { threadId: thread.id, projectId },
      {
        onSuccess: (created) => {
          setPickTaskProject(false);
          toast.success(
            t('taskCreated', { id: `${created.projectKey}-${created.sequenceNumber}` }),
            {
              action: {
                label: t('openTask'),
                onClick: () => router.push(issuePath(created.projectKey, created.sequenceNumber)),
              },
            },
          );
        },
      },
    );

  const button = (label: string, icon: React.ReactNode, onClick: () => void, disabled = false) => (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
    </Button>
  );

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b px-2 py-1">
      <span className="md:hidden">{button(t('back'), <ArrowLeft />, onBack)}</span>
      {button(t('reply'), <Reply />, () => onDraft('reply'))}
      {button(t('replyAll'), <ReplyAll />, () => onDraft('reply_all'))}
      {button(t('forward'), <Forward />, () => onDraft('forward'))}
      <span className="mx-1 h-5 border-s" />
      {button(t('archive'), <Archive />, onArchive)}
      {button(unread ? t('markRead') : t('markUnread'), unread ? <MailOpen /> : <Mail />, () =>
        action.mutate({ threadId: thread.id, action: unread ? 'read' : 'unread' }),
      )}
      {button(
        flagged ? t('unflag') : t('flag'),
        <Star className={flagged ? 'fill-current text-amber-500' : undefined} />,
        () => action.mutate({ threadId: thread.id, action: flagged ? 'unflag' : 'flag' }),
      )}
      {button(t('trash'), <Trash2 />, () => {
        action.mutate({ threadId: thread.id, action: 'trash' });
        onRemoved();
      })}
      <span className="mx-1 h-5 border-s" />
      {button(t('move'), <FolderInput />, onMove)}
      {button(
        t('createTask'),
        <ListPlus />,
        () => (thread.projectId ? task() : setPickTaskProject(true)),
        createTask.isPending,
      )}
      {button(
        t('saveNote'),
        <NotebookPen />,
        () =>
          saveNote.mutate(thread.id, {
            onSuccess: (note) => toast.success(t('noteSaved', { path: note.path })),
          }),
        saveNote.isPending,
      )}
      {pickTaskProject && (
        <ProjectPickerDialog
          title={t('taskProjectTitle')}
          description={t('taskProjectDescription')}
          projects={projects}
          currentProjectId={null}
          allowHome={false}
          pending={createTask.isPending}
          onClose={() => setPickTaskProject(false)}
          onPick={(projectId) => projectId != null && task(projectId)}
        />
      )}
    </div>
  );
}
