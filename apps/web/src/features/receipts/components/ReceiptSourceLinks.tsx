'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ListTodo, Mail } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  getReceiptOriginalMail,
  type ReceiptDetail,
  type ReceiptOriginalMail,
} from '@/lib/api/endpoints/receipts';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { inboxPath, issuePath } from '@/utils/paths';
import ReceiptOriginalMailView from './ReceiptOriginalMailView';

export default function ReceiptSourceLinks({
  projectKey,
  receiptId,
  source,
}: {
  projectKey: string;
  receiptId: number;
  source: ReceiptDetail['sourceLinks'];
}) {
  const t = useTranslations('receipts.detail');
  const [open, setOpen] = useState(false);
  const [mail, setMail] = useState<ReceiptOriginalMail | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const showOriginal = async () => {
    setMail(null);
    setFailed(false);
    setLoading(true);
    setOpen(true);
    try {
      setMail(await getReceiptOriginalMail(projectKey, receiptId));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };
  if (!source) return <p className="text-xs text-muted-foreground">{t('sourceUnavailable')}</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {source.archived ? (
        <Button size="sm" variant="ghost" disabled={loading} onClick={() => void showOriginal()}>
          <Mail />
          {t('sourceArchivedMail')}
        </Button>
      ) : (
        <Button size="sm" variant="ghost" asChild>
          <Link href={`${inboxPath(projectKey)}?thread=${source.threadId}`} prefetch={false}>
            <Mail />
            {t('sourceMail')}
          </Link>
        </Button>
      )}
      {source.issues.map((issue) => (
        <Button key={issue.id} size="sm" variant="ghost" asChild>
          <Link href={issuePath(issue.projectKey, issue.sequenceNumber)} prefetch={false}>
            <ListTodo />
            {t('sourceTask', { identifier: issue.identifier })}
          </Link>
        </Button>
      ))}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="large" className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('sourceArchivedMail')}</DialogTitle>
            <DialogDescription>{t('sourceArchiveReadOnly')}</DialogDescription>
          </DialogHeader>
          {loading && <p>{t('sourceLoading')}</p>}
          {failed && <p role="alert">{t('sourceUnavailable')}</p>}
          {mail && <ReceiptOriginalMailView mail={mail} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
