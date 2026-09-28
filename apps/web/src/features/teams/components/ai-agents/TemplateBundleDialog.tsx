'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  exportBundle,
  getBundleOffers,
  importBundle,
  type BundleReport,
} from '@/lib/api/endpoints/templateBundles';
import { cn } from '@/lib/utils';

// "Vorlagen importieren": a template bundle (docs/helena-decisions/template-bundles.md)
// into the team, from the bundles on offer (Helena's agent pool, plugins' packs) or from a
// file. The first run is a dry run that lists what would change; nothing that exists is
// overwritten unless "Abweichungen übernehmen" is on.
export function TemplateBundleImportDialog({
  teamId,
  open,
  onOpenChange,
}: {
  teamId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('teams.templateBundles');
  const qc = useQueryClient();
  const offers = useQuery({
    queryKey: ['templateBundleOffers', teamId],
    queryFn: () => getBundleOffers(teamId),
    enabled: open,
  });
  const [offer, setOffer] = useState<string | null>(null);
  const [file, setFile] = useState<{ name: string; bundle: unknown } | null>(null);
  const [dryRun, setDryRun] = useState(true);
  const [update, setUpdate] = useState(false);
  const [report, setReport] = useState<BundleReport | null>(null);
  // Whether the report shown is of a dry run.
  const [dryRunShown, setDryRunShown] = useState(true);
  const input = useRef<HTMLInputElement>(null);
  const run = useMutation({
    mutationFn: () =>
      importBundle(teamId, {
        ...(file ? { bundle: file.bundle } : { offer: offer ?? undefined }),
        dryRun,
        update,
      }),
    onSuccess: (result) => {
      setReport(result);
      setDryRunShown(dryRun);
      if (!dryRun) void qc.invalidateQueries();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : t('failed')),
  });

  async function pickFile(list: FileList | null) {
    const chosen = list?.[0];
    if (!chosen) return;
    try {
      setFile({ name: chosen.name, bundle: JSON.parse(await chosen.text()) as unknown });
      setOffer(null);
      setReport(null);
    } catch {
      toast.error(t('notJson'));
    }
  }

  const ready = !!file || !!offer;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('importTitle')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            {(offers.data ?? []).map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => {
                  setOffer(entry.id);
                  setFile(null);
                  setReport(null);
                }}
                className={cn(
                  'flex w-full flex-col items-start rounded-md border bg-card px-3 py-2 text-start hover:bg-accent',
                  offer === entry.id && 'border-primary bg-accent',
                )}
              >
                <span className="font-medium">
                  {entry.label} <span className="text-muted-foreground">{entry.version}</span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {t('counts', {
                    agents: entry.agents,
                    skills: entry.skills,
                    servers: entry.mcpServers,
                  })}
                </span>
              </button>
            ))}
            <input
              ref={input}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(event) => void pickFile(event.target.files)}
            />
            <Button variant="outline" size="sm" onClick={() => input.current?.click()}>
              {file ? t('fileChosen', { name: file.name }) : t('chooseFile')}
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="bundle-dry-run"
              checked={dryRun}
              onCheckedChange={(value) => setDryRun(value === true)}
            />
            <Label htmlFor="bundle-dry-run">{t('dryRun')}</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="bundle-update"
              checked={update}
              onCheckedChange={(value) => setUpdate(value === true)}
            />
            <Label htmlFor="bundle-update">{t('update')}</Label>
          </div>
          {report ? (
            <div className="space-y-1">
              <p className="font-medium">
                {t(dryRunShown ? 'summaryDryRun' : 'summary', {
                  written: report.written,
                  unchanged: report.unchanged,
                  drift: report.drift,
                  warnings: report.warnings,
                })}
              </p>
              <pre className="max-h-64 overflow-auto rounded-md border bg-card p-2 text-xs whitespace-pre-wrap">
                {report.lines.join('\n').trim()}
              </pre>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('close')}
          </Button>
          <Button disabled={!ready || run.isPending} onClick={() => run.mutate()}>
            {dryRun ? t('check') : t('import')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// "Vorlagen exportieren": the team's agent templates as a bundle file.
export function useTemplateBundleExport(teamId: number) {
  const t = useTranslations('teams.templateBundles');
  return useMutation({
    mutationFn: () => exportBundle(teamId),
    onSuccess: (bundle) => {
      const blob = new Blob([`${JSON.stringify(bundle, null, 2)}\n`], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${bundle.name}.helena.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : t('failed')),
  });
}
