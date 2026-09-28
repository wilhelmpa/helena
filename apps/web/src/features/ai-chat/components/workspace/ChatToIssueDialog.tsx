'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { createIssue } from '@/lib/api/endpoints/issues';
import { updateChat } from '@/lib/api/endpoints/agentChat';
import { useProjectQuery } from '@/services/projects.service';
import { chatPath, issuePath } from '@/utils/paths';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

export interface ChatToIssueDialogProps {
  projectKey: string;
  threadId: string;
  agentId: number;
  defaultTitle: string;
  defaultDescription: string;
  onClose: () => void;
}

// Turns a chat, or one of its messages, into a task of the project: title and
// description prefilled from what was asked to keep, a link back to the chat on the
// new task's description, and the chat itself linked to it (issueId) so the task shows
// on the chat's header and the chat shows on the task's linked-chats list.
export default function ChatToIssueDialog({
  projectKey,
  threadId,
  agentId,
  defaultTitle,
  defaultDescription,
  onClose,
}: ChatToIssueDialogProps) {
  const t = useTranslations('chatWorkspace');
  const tCommon = useTranslations('common');
  const project = useProjectQuery(projectKey);
  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState(defaultDescription);
  const [created, setCreated] = useState<{ sequenceNumber: number; identifier: string } | null>(
    null,
  );

  const create = useMutation({
    mutationFn: async () => {
      const columnId = project.data?.columns[0]?.id;
      if (columnId == null) throw new Error('No column to create the task in');
      const chatLink = `${window.location.origin}${chatPath(projectKey, { agent: agentId, thread: threadId })}`;
      const body = description.trim();
      const issue = await createIssue(projectKey, {
        columnId,
        title: title.trim(),
        description: `${body}${body ? '\n\n' : ''}[${t('issue.linkBackLabel')}](${chatLink})`,
      });
      await updateChat(threadId, { issueId: issue.id });
      return issue;
    },
    onSuccess: (issue) => {
      setCreated({ sequenceNumber: issue.sequenceNumber, identifier: issue.identifier });
      toast.success(t('issue.created'));
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('issue.dialogTitle')}</DialogTitle>
        </DialogHeader>
        {created ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{t('issue.createdBody')}</p>
            <Link
              href={issuePath(projectKey, created.sequenceNumber)}
              className="text-sm font-medium text-primary hover:underline"
              onClick={onClose}
            >
              {created.identifier}
            </Link>
            <DialogFooter>
              <Button onClick={onClose}>{tCommon('close')}</Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (title.trim()) create.mutate();
            }}
          >
            <Field>
              <FieldLabel htmlFor="chat-issue-title">{t('issue.titleLabel')}</FieldLabel>
              <Input
                id="chat-issue-title"
                dir="auto"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={255}
                autoFocus
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="chat-issue-description">
                {t('issue.descriptionLabel')}
              </FieldLabel>
              <Textarea
                id="chat-issue-description"
                dir="auto"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={8}
              />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                {tCommon('cancel')}
              </Button>
              <Button type="submit" disabled={!title.trim() || create.isPending}>
                {t('issue.create')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
