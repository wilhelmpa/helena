import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { getFileReferences, type FileScope } from '@/lib/api/endpoints/projectFiles';
import { filesScopeKey } from '@/services/files.service';

export default function FileReferences({ scope, path }: { scope: FileScope; path: string }) {
  const t = useTranslations('files.unified');
  const query = useQuery({
    queryKey: [...filesScopeKey(scope), 'references', path],
    queryFn: () => getFileReferences(scope, path),
    retry: false,
  });
  if (!query.data) return null;
  const { author, runId, links } = query.data;
  if (!author && links.length === 0) return null;
  return (
    <div
      className="mb-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"
      aria-label={t('references')}
    >
      {author && (
        <span>
          {t('author', { author })}
          {runId ? ` · ${t('run', { run: runId })}` : ''}
        </span>
      )}
      {links.map((link) => (
        <Link key={link.href} href={link.href} className="underline underline-offset-2">
          {link.title}
        </Link>
      ))}
    </div>
  );
}
