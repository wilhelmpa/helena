import { FolderKanban, Home, LayoutTemplate, Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Project } from '@/lib/api/endpoints/projects';
import { cn } from '@/lib/utils';

export type HomeFilesRoot = 'home' | 'private' | 'templates' | `project:${string}`;

// The folders the Home Files page browses: Home, Private for the owner, Templates, and
// the folder of every project the reader works in.
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
          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm hover:bg-accent',
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
    <nav className="shrink-0 md:w-52" aria-label={t('label')}>
      <ul className="flex gap-1 overflow-x-auto md:flex-col">
        {entries.map((entry) => item(entry.root, entry.label, entry.Icon))}
      </ul>
      {projects.length > 0 && (
        <>
          <p className="mt-4 mb-1 hidden px-2 text-xs font-medium text-muted-foreground md:block">
            {t('projects')}
          </p>
          <ul className="flex gap-1 overflow-x-auto md:flex-col">
            {projects.map((project) => item(`project:${project.key}`, project.name, FolderKanban))}
          </ul>
        </>
      )}
    </nav>
  );
}
