'use client';

import { useImperativeHandle, useRef, type ReactNode, type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import { Folder, FolderKanban, Mail, MailOpen, Paperclip, PenSquare } from 'lucide-react';
import {
  PageActions,
  PageSearch,
  PageSelect,
  PageToolbar,
  PageToolbarSpacer,
} from '@/components/layout/PageToolbar';
import { PageFilterMenu } from '@/components/layout/PageFilterMenu';
import type { MailAccount, MailFolderRole } from '@/lib/api/endpoints/mail';
import type { Project } from '@/lib/api/endpoints/projects';
import { useMailFolders } from '../services/mail.service';
import type { InboxFilters } from './MailFilterBar';

const ROLES: MailFolderRole[] = ['inbox', 'sent', 'archive', 'drafts', 'trash', 'junk', 'all'];
const ALL = 'all';

// The mail inbox's controls on a page (the project inbox, Home's inbox): one header
// row like every page's (PageToolbar) — the page's own tabs first (`leading`), then the
// search, the folder, one Filter menu (account, project, read status, attachments) and
// "Verfassen" as the primary action. In the tool panel the inbox keeps its own bar (MailFilterBar).
export default function MailPageToolbar({
  leading,
  teamId,
  filters,
  onFiltersChange,
  search,
  onSearchChange,
  searchRef,
  accounts,
  projects,
  onCompose,
}: {
  leading?: ReactNode;
  teamId: number;
  filters: InboxFilters;
  onFiltersChange: (filters: InboxFilters) => void;
  search: string;
  onSearchChange: (value: string) => void;
  // Focused by the "/" shortcut: the search field's input, found in its wrapper.
  searchRef: RefObject<HTMLInputElement | null>;
  accounts: MailAccount[];
  projects: Pick<Project, 'id' | 'key' | 'name'>[] | null;
  onCompose: () => void;
}) {
  const t = useTranslations('mail.inbox');
  const tInbox = useTranslations('inbox');
  const folders = useMailFolders(teamId, filters.accountId);
  const set = (patch: Partial<InboxFilters>) => onFiltersChange({ ...filters, ...patch });
  const folderValue = filters.folderId ? `folder:${filters.folderId}` : filters.role;
  const searchBox = useRef<HTMLDivElement>(null);
  // The shortcut focuses whatever input the search currently renders (the field, or
  // the one it lays over the row once it has folded to an icon).
  useImperativeHandle(
    searchRef,
    () =>
      ({
        focus: () => {
          const input = searchBox.current?.querySelector('input');
          if (input) input.focus();
          else searchBox.current?.querySelector('button')?.click();
        },
      }) as HTMLInputElement,
  );

  return (
    <PageToolbar>
      {leading}
      <PageToolbarSpacer />
      <div ref={searchBox} className="contents">
        <PageSearch value={search} onChange={onSearchChange} placeholder={t('search')} />
      </div>
      <PageSelect
        label={t('folder')}
        icon={Folder}
        value={folderValue}
        defaultValue="inbox"
        onChange={(value) =>
          value.startsWith('folder:')
            ? set({ folderId: Number(value.slice(7)) })
            : set({ role: value as MailFolderRole, folderId: undefined })
        }
        options={[
          ...ROLES.map((role) => ({ value: role as string, label: t(`roles.${role}`) })),
          ...(folders.data ?? [])
            .filter((folder) => !folder.role)
            .map((folder) => ({ value: `folder:${folder.id}`, label: folder.path })),
        ]}
      />
      <PageFilterMenu
        label={tInbox('filter')}
        resetLabel={tInbox('mailFilter.reset')}
        onReset={() => set({ accountId: undefined, scope: ALL, unread: false, attachments: false })}
        filters={[
          ...(accounts.length > 1
            ? [
                {
                  id: 'account',
                  label: t('account'),
                  icon: Mail,
                  value: filters.accountId ? String(filters.accountId) : ALL,
                  defaultValue: ALL,
                  onChange: (value: string) =>
                    set({
                      accountId: value === ALL ? undefined : Number(value),
                      folderId: undefined,
                    }),
                  options: [
                    { value: ALL, label: t('allAccounts') },
                    ...accounts.map((account) => ({
                      value: String(account.id),
                      label: account.address,
                    })),
                  ],
                },
              ]
            : []),
          ...(projects
            ? [
                {
                  id: 'project',
                  label: t('project'),
                  icon: FolderKanban,
                  value: String(filters.scope),
                  defaultValue: ALL,
                  onChange: (value: string) =>
                    set({ scope: value === ALL || value === 'home' ? value : Number(value) }),
                  options: [
                    { value: ALL, label: t('allProjects') },
                    { value: 'home', label: t('home') },
                    ...projects.map((project) => ({
                      value: String(project.id),
                      label: project.name,
                    })),
                  ],
                },
              ]
            : []),
          {
            id: 'read',
            label: tInbox('mailFilter.read'),
            icon: MailOpen,
            value: filters.unread ? 'unread' : ALL,
            defaultValue: ALL,
            onChange: (value: string) => set({ unread: value === 'unread' }),
            options: [
              { value: ALL, label: tInbox('mailFilter.any') },
              { value: 'unread', label: t('unread') },
            ],
          },
          {
            id: 'attachments',
            label: tInbox('mailFilter.attachments'),
            icon: Paperclip,
            value: filters.attachments ? 'with' : ALL,
            defaultValue: ALL,
            onChange: (value: string) => set({ attachments: value === 'with' }),
            options: [
              { value: ALL, label: tInbox('mailFilter.any') },
              { value: 'with', label: t('withAttachments') },
            ],
          },
        ]}
      />
      <PageActions
        primary={{ id: 'compose', label: t('compose'), icon: PenSquare, onClick: onCompose }}
      />
    </PageToolbar>
  );
}
