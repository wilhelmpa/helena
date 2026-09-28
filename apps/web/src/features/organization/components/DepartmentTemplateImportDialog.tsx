'use client';

import { useId, useRef, useState } from 'react';
import { FileUp, LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/design-system';
import type { BundleReport } from '@/lib/api/endpoints/templateBundles';
import { useImportDepartmentTemplate } from '../services/organization.service';
import DepartmentTemplateReport from './DepartmentTemplateReport';
import { Inline, Stack, Text } from '@/design-system';

type Shown = { report: BundleReport; dryRun: boolean };

// "Abteilung aus Vorlage importieren": a department template file, first checked (a dry
// run that writes nothing and lists what would change), then imported. "Bestehende
// aktualisieren" also overwrites what differs in agents and settings that exist already;
// switching it checks the file again.
export default function DepartmentTemplateImportDialog({
  teamId,
  open,
  onOpenChange,
}: {
  teamId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('organization.departments');
  const tCommon = useTranslations('common');
  const id = useId();
  const run = useImportDepartmentTemplate(teamId);
  const input = useRef<HTMLInputElement>(null);
  // Only the answer to the newest request counts (a switch can re-check while one runs).
  const latest = useRef(0);
  const [file, setFile] = useState<{ name: string; bundle: unknown } | null>(null);
  const [update, setUpdate] = useState(false);
  const [shown, setShown] = useState<Shown | null>(null);

  function send(bundle: unknown, dryRun: boolean, withUpdate: boolean) {
    const request = ++latest.current;
    run.mutate(
      { bundle, dryRun, update: withUpdate },
      {
        onSuccess: (report) => {
          if (request !== latest.current) return;
          setShown({ report, dryRun });
          if (!dryRun) toast.success(t('imported'));
        },
      },
    );
  }

  async function pick(list: FileList | null) {
    const chosen = list?.[0];
    if (input.current) input.current.value = '';
    if (!chosen) return;
    let bundle: unknown;
    try {
      bundle = JSON.parse(await chosen.text()) as unknown;
    } catch {
      toast.error(t('templateNotJson'));
      return;
    }
    setFile({ name: chosen.name, bundle });
    setShown(null);
    send(bundle, true, update);
  }

  function close(next: boolean) {
    if (!next) {
      latest.current += 1;
      setFile(null);
      setShown(null);
      setUpdate(false);
    }
    onOpenChange(next);
  }

  const imported = shown !== null && !shown.dryRun;
  const canImport = file !== null && shown?.dryRun === true && !run.isPending;
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('importTemplate')}</DialogTitle>
          <DialogDescription>{t('importTemplateHint')}</DialogDescription>
        </DialogHeader>
        <Stack gap={4}>
          <input
            ref={input}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(event) => void pick(event.target.files)}
          />
          <Inline gap={3} wrap>
            <Button
              size="small"
              icon={<FileUp aria-hidden />}
              disabled={run.isPending || imported}
              onClick={() => input.current?.click()}
            >
              {t('templateChooseFile')}
            </Button>
            {file && (
              <Text as="span" size="xs" tone="muted" className="min-w-0 flex-1 truncate" dir="auto">
                {t('templateFile', { name: file.name })}
              </Text>
            )}
          </Inline>
          <Inline gap={3} justify="between">
            <div className="min-w-0">
              <label htmlFor={`${id}-update`} className="text-sm">
                {t('templateUpdate')}
              </label>
              <Text as="p" size="xs" tone="muted">
                {t('templateUpdateHint')}
              </Text>
            </div>
            <Switch
              id={`${id}-update`}
              checked={update}
              disabled={imported}
              onCheckedChange={(value) => {
                setUpdate(value);
                if (file) {
                  setShown(null);
                  send(file.bundle, true, value);
                }
              }}
            />
          </Inline>
          {run.isPending ? (
            <Text as="p" size="xs" tone="muted" className="flex items-center gap-2">
              <LoaderCircle className="size-4 animate-spin" aria-hidden />
              {run.variables?.dryRun === false ? t('templateImporting') : t('templateChecking')}
            </Text>
          ) : shown ? (
            <DepartmentTemplateReport report={shown.report} dryRun={shown.dryRun} />
          ) : null}
        </Stack>
        <DialogFooter>
          <Button variant="ghost" onClick={() => close(false)}>
            {imported ? tCommon('close') : tCommon('cancel')}
          </Button>
          {!imported && (
            <Button
              variant="primary"
              disabled={!canImport}
              onClick={() => file && send(file.bundle, false, update)}
            >
              {t('templateImport')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
