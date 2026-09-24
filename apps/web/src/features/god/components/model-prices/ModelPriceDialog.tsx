'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import type { ModelPrice } from '@/lib/api/endpoints/autopilot';
import { useSetModelPrice } from '@/services/autopilot.service';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type Fields = {
  model: string;
  provider: string;
  input: string;
  output: string;
  cacheRead: string;
  cacheWrite: string;
};

const EMPTY: Fields = {
  model: '',
  provider: '',
  input: '',
  output: '',
  cacheRead: '',
  cacheWrite: '',
};

const number = (text: string): number | null | undefined => {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
};

// The owner's own price of a model: euros per million tokens, never overwritten by an
// import. Opened on a row to override it, or empty to price a model models.dev does not list.
export default function ModelPriceDialog({
  open,
  price,
  onClose,
}: {
  open: boolean;
  price: ModelPrice | null;
  onClose: () => void;
}) {
  const t = useTranslations('autopilot.prices');
  const tCommon = useTranslations('common');
  const save = useSetModelPrice();
  const [fields, setFields] = useState<Fields>(EMPTY);

  useEffect(() => {
    if (!open) return;
    setFields(
      price
        ? {
            model: price.model,
            provider: price.provider ?? '',
            input: String(price.inputPerMTok),
            output: String(price.outputPerMTok),
            cacheRead: price.cacheReadPerMTok == null ? '' : String(price.cacheReadPerMTok),
            cacheWrite: price.cacheWritePerMTok == null ? '' : String(price.cacheWritePerMTok),
          }
        : EMPTY,
    );
  }, [open, price]);

  const input = number(fields.input);
  const output = number(fields.output);
  const cacheRead = number(fields.cacheRead);
  const cacheWrite = number(fields.cacheWrite);
  const valid =
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(fields.model.trim()) &&
    input != null &&
    output != null &&
    cacheRead !== undefined &&
    cacheWrite !== undefined;

  async function submit() {
    if (!valid) return;
    const model = fields.model.trim().toLowerCase();
    try {
      await save.mutateAsync({
        model,
        input: {
          provider: fields.provider.trim() || null,
          inputPerMTok: input!,
          outputPerMTok: output!,
          cacheReadPerMTok: cacheRead ?? null,
          cacheWritePerMTok: cacheWrite ?? null,
        },
      });
      toast.success(t('savedToast', { model }));
      onClose();
    } catch {
      // Surfaced by the global mutation error toast.
    }
  }

  const field = (key: keyof Fields, label: string, disabled = false) => (
    <div className="space-y-1">
      <label htmlFor={`model-price-${key}`} className="text-xs text-muted-foreground">
        {label}
      </label>
      <Input
        id={`model-price-${key}`}
        value={fields[key]}
        disabled={disabled}
        inputMode={key === 'model' || key === 'provider' ? undefined : 'decimal'}
        onChange={(event) => setFields({ ...fields, [key]: event.target.value })}
        className="h-8 tabular-nums"
      />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('dialogTitle')}</DialogTitle>
          <DialogDescription>{t('dialogHint')}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            {field('model', t('model'), price != null)}
            {field('provider', t('provider'))}
          </div>
          <p className="text-xs text-muted-foreground">{t('perMTok')}</p>
          <div className="grid grid-cols-2 gap-3">
            {field('input', t('input'))}
            {field('output', t('output'))}
            {field('cacheRead', t('cacheRead'))}
            {field('cacheWrite', t('cacheWrite'))}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {tCommon('cancel')}
            </Button>
            <Button type="submit" disabled={!valid || save.isPending}>
              {save.isPending ? tCommon('saving') : tCommon('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
