'use client';

import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { vaultNotePath } from '@/utils/paths';
import { useCreateTaskNote, useTaskNotesQuery } from '../../services/knowledge.service';
import { usePersistedOpen } from '../../hooks/usePersistedOpen';
import IssueKnowledgeNoteList from './IssueKnowledgeNoteList';
import IssueSectionHeading from './IssueSectionHeading';

// The notes of the project knowledge that link to this task with [[KEY-n]]. A new note
// is created with that link and opened in Docs.
export default function IssueKnowledgePanel({
  projectKey,
  identifier,
  issueTitle,
  canRead,
  canCreate,
}: {
  projectKey: string;
  identifier: string;
  issueTitle: string;
  canRead: boolean;
  canCreate: boolean;
}) {
  const t = useTranslations('issue.knowledge');
  const router = useRouter();
  const { open, toggle } = usePersistedOpen('issue-knowledge-open');
  const notes = useTaskNotesQuery(identifier, canRead);
  const createNote = useCreateTaskNote(projectKey, identifier);
  const count = notes.data?.length ?? 0;

  if (!canRead) return null;

  return (
    <div className={`mt-6 border-t pt-5 ${open ? '' : '-mb-2'}`}>
      <div className={`flex h-7 items-center gap-2 ${open ? 'mb-3' : ''}`}>
        <IssueSectionHeading
          label={t('title')}
          tally={count > 0 ? String(count) : undefined}
          open={open}
          onToggle={toggle}
        />
        {canCreate && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="ms-auto"
            aria-label={t('create')}
            title={t('create')}
            disabled={createNote.isPending}
            onClick={() =>
              void createNote
                .mutateAsync(issueTitle)
                .then((path) => router.push(vaultNotePath(path)))
                .catch(() => undefined)
            }
          >
            <Plus />
          </Button>
        )}
      </div>

      {open && <IssueKnowledgeNoteList identifier={identifier} notes={notes} />}
    </div>
  );
}
