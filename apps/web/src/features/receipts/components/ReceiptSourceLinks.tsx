'use client';

import Link from 'next/link';
import { ListTodo, Mail } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { ReceiptDetail } from '@/lib/api/endpoints/receipts';
import { inboxPath, issuePath } from '@/utils/paths';

export default function ReceiptSourceLinks({
  projectKey,
  source,
}: {
  projectKey: string;
  source: ReceiptDetail['sourceLinks'];
}) {
  const t = useTranslations('receipts.detail');
  if (!source) return <p className="text-xs text-muted-foreground">{t('sourceUnavailable')}</p>;
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="ghost" asChild>
        <Link href={`${inboxPath(projectKey)}?thread=${source.threadId}`} prefetch={false}>
          <Mail />
          {t('sourceMail')}
        </Link>
      </Button>
      {source.issues.map((issue) => (
        <Button key={issue.id} size="sm" variant="ghost" asChild>
          <Link href={issuePath(issue.projectKey, issue.sequenceNumber)} prefetch={false}>
            <ListTodo />
            {t('sourceTask', { identifier: issue.identifier })}
          </Link>
        </Button>
      ))}
    </div>
  );
}
