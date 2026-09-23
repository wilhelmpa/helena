'use client';

import { useState } from 'react';
import { History } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useNoteHistoryQuery } from '../services/knowledge.service';
import DocumentHistoryList from './DocumentHistoryList';
import DocumentVersionPreview from './DocumentVersionPreview';

export default function DocumentHistoryDialog({
  path,
  canRestore,
  onRestore,
  onClose,
}: {
  path: string;
  canRestore: boolean;
  onRestore: (content: string) => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslations('documents');
  const history = useNoteHistoryQuery(path, true);
  const [picked, setPicked] = useState<string | null>(null);
  const revisions = history.data ?? [];
  const selected = picked ?? revisions[0]?.commit ?? null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[min(86vh,760px)] overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="border-b px-5 py-4 pe-12 text-start">
          <DialogTitle className="flex items-center gap-2">
            <History className="size-4 text-muted-foreground" />
            {t('versionHistory')}
          </DialogTitle>
          <DialogDescription>{t('versionHistoryDescription')}</DialogDescription>
        </DialogHeader>
        {history.isSuccess && revisions.length === 0 ? (
          <p className="px-6 py-16 text-center text-sm text-muted-foreground">{t('noHistory')}</p>
        ) : (
          <div className="grid min-h-72 overflow-hidden md:grid-cols-[19rem_minmax(0,1fr)]">
            <DocumentHistoryList history={history} selected={selected} onSelect={setPicked} />
            <DocumentVersionPreview
              path={path}
              commit={selected}
              latest={selected === revisions[0]?.commit}
              canRestore={canRestore}
              onRestore={onRestore}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
