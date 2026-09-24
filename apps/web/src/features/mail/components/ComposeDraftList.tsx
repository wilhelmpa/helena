'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { PenLine, PenSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { setComposeDraft } from '@/hooks/useMailCompose';
import { useMailAccounts, useStartDraft } from '@/services/mail.service';
import { formatDateTime } from '@/utils/dates';
import { mailAccountsPath } from '@/utils/paths';
import { useMailDrafts } from '../services/drafts.service';

export default function ComposeDraftList({
  teamId,
  projectKey,
}: {
  teamId: number | null;
  projectKey: string | null;
}) {
  const t = useTranslations('mail.compose');
  const tNav = useTranslations('nav');
  const drafts = useMailDrafts(teamId);
  const accounts = useMailAccounts(teamId);
  const startDraft = useStartDraft(teamId ?? 0);
  const account =
    accounts.data?.find((item) => projectKey && item.projectKey === projectKey) ??
    accounts.data?.[0];

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <Button
        type="button"
        disabled={!account || startDraft.isPending}
        onClick={() => account && startDraft.mutate({ mode: 'new', accountId: account.id })}
      >
        <PenSquare />
        {t('new')}
      </Button>
      {!account && accounts.isSuccess && (
        <p className="text-sm text-muted-foreground">
          {t('noAccount')}{' '}
          <Link
            href={mailAccountsPath()}
            className="text-foreground underline-offset-2 hover:underline"
          >
            {tNav('mailAccounts')}
          </Link>
        </p>
      )}
      <section className="flex flex-col gap-1">
        <h3 className="flex h-8 items-center px-1 text-xs font-medium text-muted-foreground">
          {t('openDrafts')}
        </h3>
        {(drafts.data ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">{t('noDrafts')}</p>
        )}
        {(drafts.data ?? []).map((draft) => (
          <button
            key={draft.id}
            type="button"
            onClick={() => setComposeDraft(draft.id)}
            className="flex flex-col items-start gap-0.5 rounded-lg border bg-card px-3 py-2 text-start text-sm transition-colors hover:bg-accent"
          >
            <span className="flex w-full items-center gap-1.5">
              <PenLine className="size-3.5 shrink-0 text-muted-foreground" />
              <span dir="auto" className="flex-1 truncate font-medium">
                {draft.subject || t('noSubject')}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatDateTime(draft.updatedAt)}
              </span>
            </span>
            <span className="text-xs text-muted-foreground">
              {t(`status.${draft.status}`)}
              {draft.createdByName && ` · ${t('by', { name: draft.createdByName })}`}
            </span>
          </button>
        ))}
      </section>
    </div>
  );
}
