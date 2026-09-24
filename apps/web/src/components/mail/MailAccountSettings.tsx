'use client';

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Mail, Plus } from 'lucide-react';
import { PageActions, PageToolbar, PageToolbarSpacer } from '@/components/layout/PageToolbar';
import { Button } from '@/components/ui/button';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import type { MailAccount } from '@/lib/api/endpoints/mail';
import { useMailAccounts, useProjectMailAccounts } from '@/services/mail.service';
import { qk } from '@/services/queryKeys';
import { revScope } from '@/utils/revScopes';
import MailAccountDialog from './MailAccountDialog';
import MailAccountRow from './MailAccountRow';
import MailRuleSettings from './MailRuleSettings';

// The mail accounts of a team, or of one project when projectKey is given, with the
// import state of each. Home also lists the rules that file new mail under a project.
// Self-contained, so any settings page can show it. `page`: it is the page itself (Home's
// E-Mail-Konten), so the header row names it and holds "Konto hinzufügen" as the page's
// primary action and needs no intro line; inside another settings page it keeps its own
// title, the intro and an outline add button.
export default function MailAccountSettings({
  teamId,
  projectId = null,
  projectKey,
  canEdit = true,
  page = false,
  toolbarStart,
}: {
  teamId: number;
  projectId?: number | null;
  projectKey?: string;
  canEdit?: boolean;
  page?: boolean;
  // Controls of the page before its actions in the header row (the team select).
  toolbarStart?: ReactNode;
}) {
  const t = useTranslations('mail.accounts');
  const teamAccounts = useMailAccounts(projectKey ? null : teamId);
  const projectAccounts = useProjectMailAccounts(projectKey);
  const accounts = projectKey ? projectAccounts : teamAccounts;
  const [editing, setEditing] = useState<MailAccount | 'new' | null>(null);

  useLiveRefresh({ scope: revScope.mail(teamId), targets: [qk.mail(teamId), ['mail', 'project']] });

  return (
    <section className="flex flex-col gap-3">
      {page ? (
        <PageToolbar>
          {toolbarStart}
          <PageToolbarSpacer />
          <PageActions
            primary={
              canEdit
                ? { id: 'add', label: t('add'), icon: Plus, onClick: () => setEditing('new') }
                : undefined
            }
          />
        </PageToolbar>
      ) : (
        <div className="flex items-center gap-2">
          <h2 className="flex items-center gap-2 text-md font-medium">
            <Mail className="size-4" />
            {t('title')}
          </h2>
          {canEdit && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="ms-auto"
              onClick={() => setEditing('new')}
            >
              <Plus />
              {t('add')}
            </Button>
          )}
        </div>
      )}
      {!page && (
        <p className="text-xs text-muted-foreground">
          {projectKey ? t('projectIntro') : t('intro')}
        </p>
      )}
      {accounts.isError ? (
        <p className="rounded-lg border bg-card px-3 py-2 text-sm text-destructive">
          {t('loadError')}
        </p>
      ) : (accounts.data ?? []).length === 0 && accounts.isSuccess ? (
        <p className="rounded-lg border bg-card px-3 py-2 text-sm text-muted-foreground">
          {t('empty')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {(accounts.data ?? []).map((account) => (
            <MailAccountRow
              key={account.id}
              account={account}
              teamId={teamId}
              canEdit={canEdit}
              onEdit={() => setEditing(account)}
            />
          ))}
        </ul>
      )}
      {!projectKey && (
        <MailRuleSettings teamId={teamId} accounts={accounts.data ?? []} canEdit={canEdit} />
      )}
      {editing && (
        <MailAccountDialog
          teamId={teamId}
          account={editing === 'new' ? null : editing}
          defaultProjectId={projectId}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}
