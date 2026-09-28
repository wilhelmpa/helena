'use client';

import type { RefObject } from 'react';
import { useTranslations } from 'next-intl';
import { Paperclip, PenSquare, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { MailAccount, MailFolderRole } from '@/lib/api/endpoints/mail';
import type { Project } from '@/lib/api/endpoints/projects';
import { useMailFolders } from '../services/mail.service';
import { Inline } from '@/design-system';

export interface InboxFilters {
  role: MailFolderRole;
  folderId?: number;
  accountId?: number;
  unread: boolean;
  attachments: boolean;
  // Home only: every thread, the ones under Home, or one project's.
  scope: 'all' | 'home' | number;
}

const ROLES: MailFolderRole[] = ['inbox', 'sent', 'archive', 'drafts', 'trash', 'junk', 'all'];
const ALL = 'all';

export default function MailFilterBar({
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
  teamId: number;
  filters: InboxFilters;
  onFiltersChange: (filters: InboxFilters) => void;
  search: string;
  onSearchChange: (value: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  accounts: MailAccount[];
  // The projects to filter by, or null in a project's own inbox.
  projects: Pick<Project, 'id' | 'key' | 'name'>[] | null;
  onCompose: () => void;
}) {
  const t = useTranslations('mail.inbox');
  const folders = useMailFolders(teamId, filters.accountId);
  const set = (patch: Partial<InboxFilters>) => onFiltersChange({ ...filters, ...patch });
  const folderValue = filters.folderId ? `folder:${filters.folderId}` : filters.role;

  return (
    <Inline gap={2} padX={3} padY={2} wrap className="border-b">
      <div className="relative min-w-40 flex-1">
        <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={searchRef}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          onKeyDown={(event) => event.key === 'Escape' && event.currentTarget.blur()}
          placeholder={t('search')}
          aria-label={t('search')}
          className="h-8 ps-8"
        />
      </div>
      {accounts.length > 1 && (
        <Select
          value={filters.accountId ? String(filters.accountId) : ALL}
          onValueChange={(value) =>
            set({ accountId: value === ALL ? undefined : Number(value), folderId: undefined })
          }
        >
          <SelectTrigger size="sm" aria-label={t('account')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('allAccounts')}</SelectItem>
            {accounts.map((account) => (
              <SelectItem key={account.id} value={String(account.id)}>
                {account.address}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Select
        value={folderValue}
        onValueChange={(value) =>
          value.startsWith('folder:')
            ? set({ folderId: Number(value.slice(7)) })
            : set({ role: value as MailFolderRole, folderId: undefined })
        }
      >
        <SelectTrigger size="sm" aria-label={t('folder')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ROLES.map((role) => (
            <SelectItem key={role} value={role}>
              {t(`roles.${role}`)}
            </SelectItem>
          ))}
          {(folders.data ?? []).some((folder) => !folder.role) && <SelectSeparator />}
          {(folders.data ?? [])
            .filter((folder) => !folder.role)
            .map((folder) => (
              <SelectItem key={folder.id} value={`folder:${folder.id}`}>
                {folder.path}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
      {projects && (
        <Select
          value={String(filters.scope)}
          onValueChange={(value) =>
            set({ scope: value === ALL || value === 'home' ? value : Number(value) })
          }
        >
          <SelectTrigger size="sm" aria-label={t('project')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('allProjects')}</SelectItem>
            <SelectItem value="home">{t('home')}</SelectItem>
            {projects.map((project) => (
              <SelectItem key={project.id} value={String(project.id)}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Button
        type="button"
        size="sm"
        variant={filters.unread ? 'secondary' : 'ghost'}
        aria-pressed={filters.unread}
        onClick={() => set({ unread: !filters.unread })}
      >
        {t('unread')}
      </Button>
      <Button
        type="button"
        size="sm"
        variant={filters.attachments ? 'secondary' : 'ghost'}
        aria-pressed={filters.attachments}
        onClick={() => set({ attachments: !filters.attachments })}
      >
        <Paperclip />
        {t('withAttachments')}
      </Button>
      <Button
        type="button"
        size="sm"
        className="ms-auto"
        onClick={onCompose}
        title={t('composeHint')}
      >
        <PenSquare />
        {t('compose')}
      </Button>
    </Inline>
  );
}
