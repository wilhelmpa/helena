'use client';

import { useImperativeHandle, useRef, type ReactNode, type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import { Folder, FolderKanban, ListFilter, Mail, PenSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  PAGE_CONTROL_ACTIVE_CLASS,
  PAGE_CONTROL_CLASS,
  PageActions,
  PageSearch,
  PageSelect,
  PageToolbar,
  PageToolbarSpacer,
  usePageToolbarRoom,
} from '@/components/layout/PageToolbar';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { MailAccount, MailFolderRole } from '@/lib/api/endpoints/mail';
import type { Project } from '@/lib/api/endpoints/projects';
import { useMailFolders } from '../services/mail.service';
import type { InboxFilters } from './MailFilterBar';

const ROLES: MailFolderRole[] = ['inbox', 'sent', 'archive', 'drafts', 'trash', 'junk', 'all'];
const ALL = 'all';

// The mail inbox's controls on a page (the project inbox, Home's inbox): one header
// row like every page's (PageToolbar) — the page's own tabs first (`leading`), then the
// search, folder, account and project, the Ungelesen/Mit Anhang filter and "Verfassen"
// as the primary action. In the tool panel the inbox keeps its own bar (MailFilterBar).
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
      {accounts.length > 1 && (
        <PageSelect
          label={t('account')}
          icon={Mail}
          value={filters.accountId ? String(filters.accountId) : ALL}
          defaultValue={ALL}
          onChange={(value) =>
            set({ accountId: value === ALL ? undefined : Number(value), folderId: undefined })
          }
          options={[
            { value: ALL, label: t('allAccounts') },
            ...accounts.map((account) => ({ value: String(account.id), label: account.address })),
          ]}
        />
      )}
      {projects && (
        <PageSelect
          label={t('project')}
          icon={FolderKanban}
          value={String(filters.scope)}
          defaultValue={ALL}
          onChange={(value) =>
            set({ scope: value === ALL || value === 'home' ? value : Number(value) })
          }
          options={[
            { value: ALL, label: t('allProjects') },
            { value: 'home', label: t('home') },
            ...projects.map((project) => ({ value: String(project.id), label: project.name })),
          ]}
        />
      )}
      <MailFlagsMenu filters={filters} onChange={set} />
      <PageActions
        primary={{ id: 'compose', label: t('compose'), icon: PenSquare, onClick: onCompose }}
      />
    </PageToolbar>
  );
}

// Ungelesen and Mit Anhang, the two switches on the thread list, as one control: drawn
// active and counted while any is on.
function MailFlagsMenu({
  filters,
  onChange,
}: {
  filters: InboxFilters;
  onChange: (patch: Partial<InboxFilters>) => void;
}) {
  const t = useTranslations('mail.inbox');
  const tInbox = useTranslations('inbox');
  const room = usePageToolbarRoom();
  const count = (filters.unread ? 1 : 0) + (filters.attachments ? 1 : 0);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={tInbox('filter')}
          className={cn(
            PAGE_CONTROL_CLASS,
            count > 0 && PAGE_CONTROL_ACTIVE_CLASS,
            !room.actions && count === 0 && 'w-8 justify-center px-0',
          )}
        >
          <ListFilter aria-hidden="true" />
          {room.actions ? <span>{tInbox('filter')}</span> : null}
          {count > 0 ? (
            <span className="text-xs font-normal text-muted-foreground tabular-nums">{count}</span>
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuCheckboxItem
          checked={filters.unread}
          onCheckedChange={(unread) => onChange({ unread })}
          onSelect={(event) => event.preventDefault()}
        >
          {t('unread')}
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={filters.attachments}
          onCheckedChange={(attachments) => onChange({ attachments })}
          onSelect={(event) => event.preventDefault()}
        >
          {t('withAttachments')}
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
