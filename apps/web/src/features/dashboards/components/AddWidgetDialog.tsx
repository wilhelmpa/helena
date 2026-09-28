import { useMemo, useState } from 'react';
import { Puzzle, Search, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { resolveText } from '@helena/sdk/web';
import type { WidgetType } from '@/utils/dashboardWidgets';
import type { DashboardWidget } from '@/extensions/dashboardWidgets';
import { pluginDashboardWidget } from '@/extensions/pluginDashboardWidgets';
import { usePluginUiSlotsQuery } from '@/services/plugins.service';
import { byKey } from '@/utils/messageKey';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { WIDGET_GROUPS, WIDGET_ICON } from '../utils/widgetCatalog';
import { Stack, Text } from '@/design-system';

// Picks a widget type from the catalog and adds it to the current dashboard. Widgets
// are grouped by subject and filtered by a case-insensitive search over the label and
// description, matching the tool picker and GitHub skill import dialogs. Opened from
// the page's header row ("Widget hinzufügen" while the layout is edited).
export default function AddWidgetDialog({
  open,
  onOpenChange,
  onAdd,
  onAddPlugin,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (type: WidgetType) => void;
  onAddPlugin: (widget: DashboardWidget, label: string) => void;
}) {
  const t = useTranslations('dashboards');
  const translate = byKey(useTranslations());
  const locale = useLocale();
  const slots = usePluginUiSlotsQuery();
  const plugins = (slots.data ?? [])
    .map((slot) => pluginDashboardWidget(slot, 'project'))
    .filter((widget): widget is DashboardWidget => widget !== null)
    .map((widget) => ({
      widget,
      label: resolveText(widget.label, locale, (key) => translate(key)),
    }));
  const [query, setQuery] = useState('');

  // Each group's types narrowed to the ones matching the query; empty groups are
  // dropped so only relevant sections render.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return WIDGET_GROUPS.map((g) => ({
      key: g.key,
      types: q
        ? g.types.filter(
            (type) =>
              t(`widgets.${type}.label`).toLowerCase().includes(q) ||
              t(`widgets.${type}.description`).toLowerCase().includes(q),
          )
        : g.types,
    })).filter((g) => g.types.length > 0);
  }, [query, t]);

  function add(type: WidgetType) {
    onAdd(type);
    onOpenChange(false);
    setQuery('');
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setQuery('');
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('addWidgetTitle')}</DialogTitle>
          <DialogDescription>{t('addWidgetDescription')}</DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchWidgets')}
            className="ps-9 pe-9"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute end-3 top-1/2 -translate-y-1/2 rounded-sm text-muted-foreground transition-colors hover:text-foreground"
              aria-label={t('clearSearch')}
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        <Stack gap={4} padEnd={1} className="max-h-[55vh] overflow-y-auto">
          {groups.length === 0 &&
            !plugins.some((item) =>
              item.label.toLowerCase().includes(query.trim().toLowerCase()),
            ) && (
              <Text as="p" size="sm" tone="muted" className="py-4 text-center">
                {t('noWidgetMatches', { query: query.trim() })}
              </Text>
            )}
          {groups.map((group) => (
            <Stack gap={2} key={group.key}>
              <h3 className="px-1 text-xs font-medium text-muted-foreground">
                {t(`widgetGroups.${group.key}`)}
              </h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {group.types.map((type) => {
                  const Icon = WIDGET_ICON[type];
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => add(type)}
                      className="flex items-start gap-3 rounded-md border bg-card p-3 text-start transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0">
                        <Text as="span" size="sm" className="block font-medium">
                          {t(`widgets.${type}.label`)}
                        </Text>
                        <Text as="span" size="xs" tone="muted" className="block">
                          {t(`widgets.${type}.description`)}
                        </Text>
                      </span>
                    </button>
                  );
                })}
              </div>
            </Stack>
          ))}
          {plugins.filter((item) => item.label.toLowerCase().includes(query.trim().toLowerCase()))
            .length > 0 && (
            <Stack gap={2}>
              <h3 className="px-1 text-xs font-medium text-muted-foreground">
                {t('widgetGroups.plugins')}
              </h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {plugins
                  .filter((item) => item.label.toLowerCase().includes(query.trim().toLowerCase()))
                  .map(({ widget, label }) => (
                    <button
                      key={widget.id}
                      type="button"
                      onClick={() => {
                        onAddPlugin(widget, label);
                        onOpenChange(false);
                        setQuery('');
                      }}
                      className="flex items-start gap-3 rounded-md border bg-card p-3 text-start transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      <Puzzle className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                      <Text as="span" size="sm" className="font-medium">
                        {label}
                      </Text>
                    </button>
                  ))}
              </div>
            </Stack>
          )}
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
