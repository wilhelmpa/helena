import { BookOpen, Code2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ProjectFileRoot } from '@/lib/api/endpoints/projectFiles';
import { cn } from '@/lib/utils';

// The two folders of a project: its knowledge in the vault and its code workspace.
export default function FileRootTabs({
  root,
  onChange,
}: {
  root: ProjectFileRoot;
  onChange: (root: ProjectFileRoot) => void;
}) {
  const t = useTranslations('files.roots');
  const tabs = [
    { root: 'vault' as const, label: t('vault'), Icon: BookOpen },
    { root: 'code' as const, label: t('code'), Icon: Code2 },
  ];
  return (
    <div role="tablist" className="flex gap-1 border-b">
      {tabs.map((tab) => (
        <button
          key={tab.root}
          type="button"
          role="tab"
          aria-selected={root === tab.root}
          onClick={() => onChange(tab.root)}
          className={cn(
            '-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm',
            root === tab.root
              ? 'border-primary font-medium'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          <tab.Icon className="size-4" />
          {tab.label}
        </button>
      ))}
    </div>
  );
}
