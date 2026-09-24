'use client';

import { useMemo, useState } from 'react';
import { Pencil, Plus, RefreshCw, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { useLocale, useTranslations } from 'next-intl';
import type { ModelPrice } from '@/lib/api/endpoints/autopilot';
import {
  useImportModelPrices,
  useModelPrices,
  useResetModelPrice,
  useSetModelPriceRate,
} from '@/services/autopilot.service';
import { formatDateTime } from '@/utils/dates';
import {
  PageActions,
  PageSearch,
  PageToolbar,
  PageToolbarSpacer,
} from '@/components/layout/PageToolbar';
import ListSkeleton from '@/components/common/skeleton/ListSkeleton';
import TableCard from '@/components/common/page/TableCard';
import SettingsCard from '@/components/common/page/SettingsCard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import GodSectionPage from './components/GodSectionPage';
import ModelPriceDialog from './components/model-prices/ModelPriceDialog';

// Administrator → Modellpreise: euros per million tokens per model, from models.dev
// (converted at the owner's exchange rate) or entered by hand, which no import overwrites.
// Every cost the app shows is estimated from this table.
export default function GodModelPricesPage() {
  const t = useTranslations('autopilot.prices');
  const locale = useLocale();
  const query = useModelPrices();
  const importPrices = useImportModelPrices();
  const reset = useResetModelPrice();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<ModelPrice | 'new' | null>(null);

  const items = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const all = query.data?.items ?? [];
    return needle
      ? all.filter(
          (item) =>
            item.model.includes(needle) || (item.provider ?? '').toLowerCase().includes(needle),
        )
      : all;
  }, [query.data, search]);

  const money = (value: number | null) =>
    value == null
      ? t('none')
      : new Intl.NumberFormat(locale, {
          style: 'currency',
          currency: 'EUR',
          maximumFractionDigits: value < 1 ? 3 : 2,
        }).format(value);

  async function runImport() {
    try {
      const result = await importPrices.mutateAsync('models.dev');
      toast.success(t('importedToast', { count: result.imported, manual: result.keptManual }));
    } catch {
      // Surfaced by the global mutation error toast.
    }
  }

  async function resetPrice(model: string) {
    try {
      await reset.mutateAsync(model);
      toast.success(t('resetToast', { model }));
    } catch {
      // Surfaced by the global mutation error toast.
    }
  }

  const settings = query.data?.settings;

  return (
    <GodSectionPage slug="model-prices" widthClassName="max-w-none">
      <PageToolbar>
        <PageToolbarSpacer />
        <PageSearch value={search} onChange={setSearch} placeholder={t('search')} />
        <PageActions
          actions={[
            {
              id: 'import',
              label: importPrices.isPending ? t('importing') : t('import'),
              icon: RefreshCw,
              disabled: importPrices.isPending,
              onClick: () => void runImport(),
            },
          ]}
          primary={{ id: 'add', label: t('add'), icon: Plus, onClick: () => setEditing('new') }}
        />
      </PageToolbar>

      {settings && <RateCard usdToEur={settings.usdToEur} />}
      {settings?.importedAt && (
        <p className="text-xs text-muted-foreground">
          {t('importedAt', {
            date: formatDateTime(settings.importedAt),
            from: settings.importedFrom ? t(`from.${settings.importedFrom}`) : '',
          })}
        </p>
      )}

      {query.isPending ? (
        <ListSkeleton rows={8} rowClassName="h-10" />
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('model')}</TableHead>
                <TableHead>{t('provider')}</TableHead>
                <TableHead className="text-end">{t('input')}</TableHead>
                <TableHead className="text-end">{t('output')}</TableHead>
                <TableHead className="text-end">{t('cacheRead')}</TableHead>
                <TableHead className="text-end">{t('cacheWrite')}</TableHead>
                <TableHead>{t('sourceLabel')}</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.model}>
                  <TableCell className="font-mono text-xs">{item.model}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {item.provider ?? t('none')}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {money(item.inputPerMTok)}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {money(item.outputPerMTok)}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {money(item.cacheReadPerMTok)}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {money(item.cacheWritePerMTok)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={item.source === 'manual' ? 'secondary' : 'outline'}>
                      {t(`source.${item.source}`)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-0.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label={t('edit')}
                        onClick={() => setEditing(item)}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      {item.source === 'manual' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          aria-label={t('reset')}
                          disabled={reset.isPending}
                          onClick={() => void resetPrice(item.model)}
                        >
                          <RotateCcw className="size-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      )}
      <p className="text-xs text-muted-foreground">
        {t('perMTok')} · {t('estimate')}
      </p>

      <ModelPriceDialog
        open={editing != null}
        price={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)}
      />
    </GodSectionPage>
  );
}

function RateCard({ usdToEur }: { usdToEur: number }) {
  const t = useTranslations('autopilot.prices');
  const tCommon = useTranslations('common');
  const setRate = useSetModelPriceRate();
  const [text, setText] = useState(String(usdToEur));
  const value = Number(text.replace(',', '.'));
  const valid = Number.isFinite(value) && value > 0 && value < 100;

  async function save() {
    try {
      await setRate.mutateAsync(value);
      toast.success(t('rateSaved'));
    } catch {
      // Surfaced by the global mutation error toast.
    }
  }

  return (
    <SettingsCard className="flex flex-wrap items-end gap-3 p-4">
      <div className="space-y-1">
        <label htmlFor="model-price-rate" className="text-sm font-medium">
          {t('rate')}
        </label>
        <p className="text-xs text-muted-foreground">{t('rateHint')}</p>
      </div>
      <div className="ms-auto flex items-center gap-2">
        <Input
          id="model-price-rate"
          inputMode="decimal"
          value={text}
          onChange={(event) => setText(event.target.value)}
          className="h-8 w-24 tabular-nums"
        />
        <Button
          variant="outline"
          size="sm"
          disabled={!valid || value === usdToEur || setRate.isPending}
          onClick={() => void save()}
        >
          {setRate.isPending ? tCommon('saving') : tCommon('save')}
        </Button>
      </div>
    </SettingsCard>
  );
}
