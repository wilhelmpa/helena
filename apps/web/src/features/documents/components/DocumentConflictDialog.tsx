'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useVaultNoteQuery, useWriteNote } from '../services/knowledge.service';
import type { NoteSnapshot } from '../utils/noteDraft';
import type { Frontmatter } from '../utils/noteFrontmatter';

// The note as it is now beside the unsaved edits, both as Markdown. "Mine" can be
// edited to merge the two by hand before it is kept.
export default function DocumentConflictDialog({
  path,
  mine,
  frontmatterFor,
  onResolved,
  onClose,
}: {
  path: string;
  mine: string;
  frontmatterFor: (theirs: Frontmatter) => Frontmatter;
  onResolved: (sha: string, snapshot: NoteSnapshot) => void;
  onClose: () => void;
}) {
  const t = useTranslations('documents');
  const theirs = useVaultNoteQuery(path);
  const { refetch } = theirs;
  const write = useWriteNote();
  const [text, setText] = useState(mine);
  const latest = theirs.data;

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const keepMine = async () => {
    if (!latest) return;
    const frontmatter = frontmatterFor(latest.frontmatter);
    try {
      const written = await write.mutateAsync({
        path,
        body: text,
        frontmatter,
        expectedSha: latest.sha256,
      });
      onResolved(written.sha256, { body: text, frontmatter });
    } catch {
      void refetch();
    }
  };

  const textareaClass = 'min-h-72 flex-1 resize-none font-mono text-xs leading-5';

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-4 sm:max-w-5xl">
        <DialogHeader className="text-start">
          <DialogTitle>{t('conflictTitle')}</DialogTitle>
          <DialogDescription>{t('conflictDescription')}</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto md:grid-cols-2">
          <label className="flex min-h-0 flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">{t('theirs')}</span>
            <Textarea readOnly value={latest?.body ?? ''} dir="auto" className={textareaClass} />
          </label>
          <label className="flex min-h-0 flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">{t('mine')}</span>
            <Textarea
              value={text}
              dir="auto"
              className={textareaClass}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={!latest || write.isPending}
            onClick={() =>
              latest &&
              onResolved(latest.sha256, { body: latest.body, frontmatter: latest.frontmatter })
            }
          >
            {t('takeTheirs')}
          </Button>
          <Button disabled={!latest || write.isPending} onClick={() => void keepMine()}>
            {t('keepMine')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
