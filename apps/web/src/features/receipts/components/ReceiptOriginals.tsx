'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SectionLabel } from '@/components/common/page/RowList';
import type { ReceiptDetail } from '@/lib/api/endpoints/receipts';
import { useReceiptOriginalLink, useReceiptsQuery } from '../services/receipts.service';

export function ReceiptOriginals({
  projectKey,
  receipt,
  onOpen,
}: {
  projectKey: string;
  receipt: ReceiptDetail;
  onOpen?: (id: number) => void;
}) {
  const t = useTranslations('receipts.originals');
  const [choosing, setChoosing] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const link = useReceiptOriginalLink(projectKey);
  const candidates = useReceiptsQuery(projectKey, { q: search || undefined }, choosing);
  const parentId = receipt.primaryReceiptId;
  const canAttach =
    !parentId &&
    (receipt.originalCount ?? 1) === 1 &&
    receipt.status === 'open' &&
    receipt.proposals === 0;
  const options = (candidates.data ?? []).filter(
    (r) => r.id !== receipt.id && r.status !== 'ignored',
  );
  const selectedReceipt = options.find((r) => r.id === selected);
  return (
    <section className="space-y-2">
      <SectionLabel>{t('title')}</SectionLabel>
      <p className="text-xs text-muted-foreground">{parentId ? t('supplement') : t('hint')}</p>
      {(receipt.originals ?? []).map((original) => (
        <div key={original.id} className="flex items-center gap-2">
          <Button
            variant="ghost"
            className="min-w-0 flex-1 justify-start truncate"
            disabled={!onOpen || original.id === receipt.id}
            onClick={() => onOpen?.(original.id)}
          >
            {original.filename}
            {original.id === (parentId ?? receipt.id) ? ` · ${t('primary')}` : ''}
          </Button>
          {original.id !== (parentId ?? receipt.id) && (
            <Button
              variant="outline"
              size="sm"
              disabled={link.isPending}
              onClick={() =>
                link.mutate({
                  receiptId: original.id,
                  primaryReceiptId: parentId ?? receipt.id,
                  attach: false,
                })
              }
            >
              {t('detach')}
            </Button>
          )}
        </div>
      ))}
      {canAttach && !choosing && (
        <Button variant="outline" size="sm" onClick={() => setChoosing(true)}>
          {t('choose')}
        </Button>
      )}
      {canAttach && choosing && (
        <div className="space-y-2">
          <Input
            aria-label={t('search')}
            placeholder={t('search')}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setSelected(null);
            }}
          />
          <select
            className="w-full rounded border bg-background p-2 text-sm"
            aria-label={t('primary')}
            value={selected ?? ''}
            onChange={(event) =>
              setSelected(event.target.value ? Number(event.target.value) : null)
            }
          >
            <option value="">{t('select')}</option>
            {options.map((r) => (
              <option key={r.id} value={r.id}>
                {r.issuer ?? r.filename} · {r.invoiceNumber ?? r.filename} · {r.invoiceDate ?? ''}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">{t('confirmHint')}</p>
          <Button
            disabled={!selectedReceipt || link.isPending}
            onClick={() =>
              selectedReceipt &&
              link.mutate(
                { receiptId: receipt.id, primaryReceiptId: selectedReceipt.id, attach: true },
                { onSuccess: () => setChoosing(false) },
              )
            }
          >
            {t('attach')}
          </Button>
        </div>
      )}
    </section>
  );
}
