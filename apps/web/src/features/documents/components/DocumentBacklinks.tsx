'use client';

import Link from 'next/link';
import { FileText } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Skeleton } from '@/components/ui/skeleton';
import { vaultNotePath } from '@/utils/paths';
import { useBacklinksQuery } from '../services/knowledge.service';

export default function DocumentBacklinks({ path }: { path: string }) {
  const t = useTranslations('documents');
  const backlinks = useBacklinksQuery(path);

  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {t('backlinks')}
      </h3>
      {backlinks.isPending ? (
        <Skeleton className="h-7 w-full" />
      ) : backlinks.isError ? (
        <p className="text-xs text-muted-foreground">{t('backlinksLoadFailed')}</p>
      ) : backlinks.data.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('noBacklinks')}</p>
      ) : (
        <ul className="space-y-px">
          {backlinks.data.map((note) => (
            <li key={note.path}>
              <Link
                href={vaultNotePath(note.path)}
                className="flex h-7 items-center gap-2 rounded-md px-2 text-sm hover:bg-muted"
                title={note.path}
              >
                <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate" dir="auto">
                  {note.title}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
