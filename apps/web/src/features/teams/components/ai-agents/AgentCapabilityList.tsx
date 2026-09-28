import { useMemo, useState } from 'react';
import { Switch } from '@/components/ui/switch';
import { SettingsGroup, SettingsRow } from '@/design-system';
import { useTranslations } from 'next-intl';
import { groupInOrder } from '../../utils/agentForm';
import { AgentListSearch, SEARCH_THRESHOLD } from './AgentListSearch';

// One selectable capability row (a skill or a configured tool), normalized so the
// list renders skills and tools the same way. `search` is the lowercased haystack the
// filter matches against; `group` is the heading the row sits under, when the list is
// grouped at all.
export interface CapabilityItem {
  id: number;
  checked: boolean;
  title: string;
  subtitle?: string;
  group?: string;
  search: string;
}

// A searchable, height-capped checklist of an agent's capabilities. The list scrolls
// past a fixed height so a big library does not push the rest of the form off screen.
// Shared by the Skills and Tools sections of the agent form.
export function AgentCapabilityList({
  items,
  onToggle,
  searchPlaceholder,
}: {
  items: CapabilityItem[];
  onToggle: (id: number, on: boolean) => void;
  searchPlaceholder: string;
}) {
  const t = useTranslations('teams.agents');
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q ? items.filter((i) => i.search.includes(q)) : items;
    return groupInOrder(matches, (i) => i.group ?? '');
  }, [items, query]);

  return (
    <div className="ds-capability-list">
      {items.length > SEARCH_THRESHOLD && (
        <AgentListSearch value={query} onChange={setQuery} placeholder={searchPlaceholder} />
      )}

      {groups.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">
          {t('noMatch', { query: query.trim() })}
        </p>
      ) : (
        groups.map(([group, groupItems]) => (
          <SettingsGroup key={group} title={group || undefined}>
            {groupItems.map((item) => (
              <SettingsRow key={item.id} label={item.title} description={item.subtitle}>
                <Switch
                  aria-label={item.title}
                  checked={item.checked}
                  onCheckedChange={(v) => onToggle(item.id, v)}
                />
              </SettingsRow>
            ))}
          </SettingsGroup>
        ))
      )}
    </div>
  );
}
