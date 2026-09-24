import { useState } from 'react';
import { Check, ChevronDown, Layers, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { View } from '@/lib/api/endpoints/views';
import { cn } from '@/lib/utils';
import { ViewIcon } from '@/utils/viewIcons';
import { PAGE_CONTROL_CLASS } from '@/components/layout/PageToolbar';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

// The folded view picker (a phone, a narrow header row): the tab strip collapses into
// a dropdown showing the active view, listing All + saved views (searchable) and a New view action. Item values
// are ids, not names — two views may share a name — and the name is passed as a
// search keyword.
export default function MobileViewSwitcher({
  views,
  activeViewId,
  canCreate,
  onSelect,
  onNewView,
}: {
  views: View[];
  activeViewId: number | null;
  canCreate: boolean;
  onSelect: (id: number | null) => void;
  onNewView: () => void;
}) {
  const t = useTranslations('views');
  const [open, setOpen] = useState(false);
  const active = activeViewId != null ? (views.find((v) => v.id === activeViewId) ?? null) : null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={t('switchView')}
          className={cn(PAGE_CONTROL_CLASS, 'min-w-0 whitespace-nowrap text-foreground')}
        >
          {active ? <ViewIcon name={active.icon} /> : <Layers />}
          <span className="truncate">{active ? active.name : t('all')}</span>
          <ChevronDown className="!size-3.5 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-0">
        <Command>
          <CommandInput placeholder={t('searchViews')} />
          <CommandList>
            <CommandEmpty>{t('noViews')}</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__all__"
                keywords={[t('all')]}
                onSelect={() => {
                  onSelect(null);
                  setOpen(false);
                }}
                className={cn(activeViewId === null && 'bg-accent/50')}
              >
                <Layers className="size-4" />
                <span className="min-w-0 flex-1 truncate">{t('all')}</span>
                {activeViewId === null && <Check className="size-4 shrink-0" />}
              </CommandItem>
              {views.map((v) => (
                <CommandItem
                  key={v.id}
                  value={String(v.id)}
                  keywords={[v.name]}
                  onSelect={() => {
                    onSelect(v.id);
                    setOpen(false);
                  }}
                  className={cn(activeViewId === v.id && 'bg-accent/50')}
                >
                  <ViewIcon name={v.icon} className="size-4" />
                  <span className="min-w-0 flex-1 truncate">{v.name}</span>
                  {activeViewId === v.id && <Check className="size-4 shrink-0" />}
                </CommandItem>
              ))}
            </CommandGroup>
            {canCreate && (
              <CommandGroup>
                <CommandItem
                  value={t('newView')}
                  onSelect={() => {
                    onNewView();
                    setOpen(false);
                  }}
                >
                  <Plus className="size-4" />
                  {t('newView')}
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
