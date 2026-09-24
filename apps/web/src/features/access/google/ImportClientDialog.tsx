'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import Modal from '@/components/common/overlay/Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { GoogleEngine } from '@/lib/api/endpoints/access';
import { useImportGoogleClient } from '@/services/access.service';

// "OAuth-Client-JSON importieren": the owner uploads the client file Google Cloud gives
// out. Helena keeps it encrypted (its secret never comes back), or hands it to gog.
export function ImportClientDialog({
  teamId,
  gogAvailable,
  onClose,
}: {
  teamId: number;
  gogAvailable: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('access.clientDialog');
  const tGoogle = useTranslations('access.google');
  const tCommon = useTranslations('common');
  const [json, setJson] = useState('');
  const [label, setLabel] = useState('');
  const [engine, setEngine] = useState<GoogleEngine>('helena');
  const save = useImportGoogleClient(teamId);

  async function readFile(file: File | undefined) {
    if (!file) return;
    setJson(await file.text());
  }

  async function submit() {
    try {
      const result = await save.mutateAsync({ json, label: label.trim() || undefined, engine });
      toast.success(result.client ? t('imported') : t('handedToGog'));
      onClose();
    } catch {
      // Toasted by the request layer.
    }
  }

  return (
    <Modal title={t('title')} description={t('fileHint')} onClose={onClose}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (json.trim()) void submit();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="client-file">{t('file')}</Label>
          <Input
            id="client-file"
            type="file"
            accept="application/json,.json"
            onChange={(event) => void readFile(event.target.files?.[0])}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="client-json">{t('paste')}</Label>
          <Textarea
            id="client-json"
            rows={4}
            dir="ltr"
            className="font-mono text-xs"
            value={json}
            onChange={(event) => setJson(event.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="client-label">{t('label')}</Label>
            <Input
              id="client-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </div>
          {gogAvailable && (
            <div className="flex flex-col gap-1.5">
              <Label>{t('target')}</Label>
              <Select value={engine} onValueChange={(value) => setEngine(value as GoogleEngine)}>
                <SelectTrigger aria-label={t('target')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="helena">{tGoogle('engine.helena')}</SelectItem>
                  <SelectItem value="gog">{tGoogle('engine.gog')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
            {tCommon('cancel')}
          </Button>
          <Button type="submit" disabled={!json.trim() || save.isPending}>
            {t('import')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
