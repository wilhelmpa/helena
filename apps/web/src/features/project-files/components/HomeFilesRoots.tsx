import { FolderKanban, Home, LayoutTemplate, Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { PageSelect } from '@/components/layout/PageToolbar';
import type { Project } from '@/lib/api/endpoints/projects';
import { cn } from '@/lib/utils';

export type HomeFilesRoot = 'home' | 'private' | 'templates' | `project:${string}`;

// The folders the Home Files page browses: Home, Private for the owner, Templates, and
// the folder of every project the reader works in. From md a list beside the files, like
// the sidebar; on a phone the same choice as a select in the header row
// (HomeFilesRootSelect), so the page has no second row of chips.
export default function HomeFilesRoots({
  current,
  owner,
  projects,
  onChange,
}: {
  current: HomeFilesRoot;
  owner: boolean;
  projects: Project[];
  onChange: (root: HomeFilesRoot) => void;
}) {
  const t = useTranslations('files.roots');
  const entries = [
    { root: 'home' as const, label: t('home'), Icon: Home },
    ...(owner ? [{ root: 'private' as const, label: t('private'), Icon: Lock }] : []),
    { root: 'templates' as const, label: t('templates'), Icon: LayoutTemplate },
  ];
  const item = (root: HomeFilesRoot, label: string, Icon: typeof Home) => (
    <li key={root}>
      <button
        type="button"
        onClick={() => onChange(root)}
        aria-current={current === root ? 'page' : undefined}
        className={cn(
          'flex h-8 w-full items-center gap-2 rounded-md px-2 text-start text-sm transition-colors hover:bg-accent',
          current === root && 'bg-accent font-medium',
        )}
      >
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate" dir="auto">
          {label}
        </span>
      </button>
    </li>
  );

  return (
    <nav className="w-52 shrink-0 max-md:hidden" aria-label={t('label')}>
      <ul className="flex flex-col gap-px">
        {entries.map((entry) => item(entry.root, entry.label, entry.Icon))}
      </ul>
      {projects.length > 0 && (
        <>
          <p className="mt-3 flex h-8 items-center px-2 text-xs font-medium text-muted-foreground">
            {t('projects')}
          </p>
          <ul className="flex flex-col gap-px">
            {projects.map((project) => item(`project:${project.key}`, project.name, FolderKanban))}
          </ul>
        </>
      )}
    </nav>
  );
}

// The same choice of folder for the header row on a phone.
export function HomeFilesRootSelect({
  current,
  owner,
  projects,
  onChange,
}: {
  current: HomeFilesRoot;
  owner: boolean;
  projects: Project[];
  onChange: (root: HomeFilesRoot) => void;
}) {
  const t = useTranslations('files.roots');
  const icon =
    current === 'private'
      ? Lock
      : current === 'templates'
        ? LayoutTemplate
        : current === 'home'
          ? Home
          : FolderKanban;
  return (
    <PageSelect<HomeFilesRoot>
      label={t('label')}
      icon={icon}
      value={current}
      onChange={onChange}
      options={[
        { value: 'home', label: t('home'), icon: Home },
        ...(owner ? [{ value: 'private' as const, label: t('private'), icon: Lock }] : []),
        { value: 'templates', label: t('templates'), icon: LayoutTemplate },
        ...projects.map((project) => ({
          value: `project:${project.key}` as const,
          label: project.name,
          icon: FolderKanban,
        })),
      ]}
    />
  );
}
