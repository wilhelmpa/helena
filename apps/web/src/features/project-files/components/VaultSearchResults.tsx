import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { searchKnowledge } from '@/lib/api/endpoints/knowledge';
import { vaultNotePath } from '@/utils/paths';

export default function VaultSearchResults({ query, root }: { query: string; root: string }) {
  const t = useTranslations('files.unified');
  const [debounced, setDebounced] = useState(query);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(timer);
  }, [query]);
  const result = useQuery({
    queryKey: ['vault-file-search', root, debounced],
    queryFn: () => searchKnowledge(debounced, root, 50),
    retry: false,
  });
  if (result.isPending) return <p role="status">{t('searching')}</p>;
  if (result.isError) return <p role="alert">{t('searchError')}</p>;
  return (
    <section aria-label={t('search')} className="space-y-2">
      <p className="text-sm text-muted-foreground">{t('searchScope', { root })}</p>
      {result.data.items.length === 0 && <p className="text-sm">{t('noResults')}</p>}
      {result.data.items.map((item) => (
        <Link
          key={item.path}
          href={vaultNotePath(item.path)}
          className="block rounded-md border p-3 hover:bg-accent"
        >
          <p className="text-sm font-medium">{item.title}</p>
          <p className="text-xs break-all text-muted-foreground">{item.path}</p>
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{item.snippet}</p>
        </Link>
      ))}
      {result.data.items.length === 50 && (
        <p className="text-xs text-muted-foreground">{t('refine')}</p>
      )}
    </section>
  );
}
