import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { IntegrationMeta } from '@/lib/api/endpoints/integrations';
import { Input } from '@/components/ui/input';
import { IntegrationIcon } from '@/components/common/IntegrationIcon';
import { useTranslations } from 'next-intl';

// The kinds of integration, in picker order. Their name and blurb are messages under
// `teams.integrations.groups`.
const GROUPS: IntegrationMeta['kind'][] = ['tool'];

// Step one of adding a credential: pick the integration, from a full-width searchable
// list grouped by kind. Selecting an integration advances to its credential form.
export function IntegrationPicker({
  catalog,
  onSelect,
}: {
  catalog: IntegrationMeta[];
  onSelect: (key: string) => void;
}) {
  const t = useTranslations('teams.integrations');
  const [query, setQuery] = useState('');

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter(
      (c) => c.label.toLowerCase().includes(q) || c.key.toLowerCase().includes(q),
    );
  }, [catalog, query]);

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('search')}
          className="ps-9"
        />
      </div>

      <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-1">
        {matches.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">
            {t('noMatches', { query: query.trim() })}
          </p>
        )}
        {GROUPS.map((kind) => {
          const items = matches.filter((c) => c.kind === kind);
          if (items.length === 0) return null;
          return (
            <div key={kind} className="space-y-1.5">
              <div className="flex items-baseline gap-2 px-1">
                <h3 className="text-xs font-semibold text-foreground">
                  {t(`groups.${kind}.title`)}
                </h3>
                <span className="text-xs text-muted-foreground">{t(`groups.${kind}.hint`)}</span>
              </div>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {items.map((integration) => (
                  <button
                    key={integration.key}
                    type="button"
                    onClick={() => onSelect(integration.key)}
                    className="flex items-center gap-3 rounded-md border border-transparent px-2 py-2 text-left transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <IntegrationIcon integration={integration} className="size-8" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {integration.label}
                      </span>
                      {integration.tools.length > 0 && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {t('toolCount', { count: integration.tools.length })}
                        </span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
