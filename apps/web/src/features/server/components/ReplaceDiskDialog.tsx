'use client';

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import CopyableCommand from '@/components/common/page/CopyableCommand';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { StorageStatus } from '@/lib/api/endpoints/server';
import { cn } from '@/lib/utils';
import { formatDiskSize } from '../utils/serverFormat';
import { recoveryPlan, replacementPlan } from '../utils/replaceDisk';

// "Platte ersetzen": the guided replacement of a mirror disk, with the commands filled in
// from this machine (the array, the healthy disk, its partitions, the EFI mounts and boot
// entries). Helena runs none of them: the owner runs them as root in the owner terminal,
// step by step, and watches the rebuild on this page. First, folded open while a disk is
// away: the check whether it only fell off the bus (a cold start brings it back).
export default function ReplaceDiskDialog({
  storage,
  onClose,
}: {
  storage: StorageStatus;
  onClose: () => void;
}) {
  const t = useTranslations('server.disks.replace');
  const tCopy = useTranslations('common');
  const candidates = storage.disks.filter((disk) => disk.arrays.length > 0 || disk.letter);
  const suggested =
    candidates.find((disk) => disk.health === 'critical') ??
    candidates.find((disk) =>
      storage.arrays.some((array) =>
        array.members.some(
          (member) =>
            disk.partitions.some((part) => part.kname === member.device) &&
            !member.states.includes('in_sync'),
        ),
      ),
    ) ??
    candidates[candidates.length - 1];
  const [selected, setSelected] = useState(suggested?.kname ?? '');
  const [newDevice, setNewDevice] = useState('');
  const plan = replacementPlan(storage, selected, newDevice);
  const recovery = recoveryPlan(storage, selected);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('intro')}</DialogDescription>
        </DialogHeader>

        <RecoverySection plan={recovery} />

        <fieldset className="space-y-2">
          <legend className="text-xs font-medium text-muted-foreground">{t('which')}</legend>
          <div className="flex flex-wrap gap-2">
            {candidates.map((disk) => (
              <button
                key={disk.kname}
                type="button"
                aria-pressed={selected === disk.kname}
                onClick={() => setSelected(disk.kname)}
                className={cn(
                  'rounded-md border border-sidebar-border px-3 py-1.5 text-start text-sm hover:bg-sidebar-accent',
                  selected === disk.kname && 'bg-sidebar-accent font-medium',
                )}
              >
                {disk.letter ? t('disk', { letter: disk.letter }) : disk.kname}
                <span className="block text-xs text-muted-foreground">
                  {disk.model ?? '–'} · {formatDiskSize(disk.sizeBytes)}
                </span>
              </button>
            ))}
          </div>
        </fieldset>

        {!plan ? (
          <p className="text-sm text-muted-foreground">{t('noPlan')}</p>
        ) : (
          <ol className="space-y-4">
            <Step n={1} title={t('step.remove')}>
              <p className="text-sm text-muted-foreground">
                {t('step.removeBody', { disk: plan.letter, partition: plan.oldPartition ?? '–' })}
              </p>
              {plan.oldPartition && (
                <CopyableCommand
                  command={plan.commands.remove}
                  copyLabel={tCopy('copy')}
                  copiedLabel={tCopy('copied')}
                />
              )}
            </Step>
            <Step n={2} title={t('step.swap')}>
              <p className="text-sm text-muted-foreground">
                {t('step.swapBody', {
                  size: formatDiskSize(plan.minimumBytes),
                  other: plan.healthyLetter,
                })}
              </p>
            </Step>
            <Step n={3} title={t('step.find')}>
              <CopyableCommand
                command="lsblk -o NAME,SIZE,MODEL,SERIAL"
                copyLabel={tCopy('copy')}
                copiedLabel={tCopy('copied')}
              />
              <label className="block space-y-1 text-sm">
                <span className="text-xs text-muted-foreground">{t('step.newDevice')}</span>
                <Input
                  value={newDevice}
                  onChange={(event) => setNewDevice(event.target.value.trim())}
                  placeholder="/dev/nvme0n1"
                  dir="ltr"
                  className="max-w-xs font-mono"
                />
              </label>
              {newDevice && !plan.newDeviceValid && (
                <p className="text-xs text-destructive">{t('step.newDeviceInvalid')}</p>
              )}
            </Step>
            <Step n={4} title={t('step.partition')}>
              <CopyableCommand
                command={plan.commands.partition}
                copyLabel={tCopy('copy')}
                copiedLabel={tCopy('copied')}
              />
            </Step>
            <Step n={5} title={t('step.esp')}>
              <p className="text-sm text-muted-foreground">
                {t('step.espBody', { mount: plan.espMount, other: plan.otherEspMount })}
              </p>
              <CopyableCommand
                command={plan.commands.esp}
                copyLabel={tCopy('copy')}
                copiedLabel={tCopy('copied')}
              />
            </Step>
            <Step n={6} title={t('step.add')}>
              <p className="text-sm text-muted-foreground">{t('step.addBody')}</p>
              <CopyableCommand
                command={plan.commands.add}
                copyLabel={tCopy('copy')}
                copiedLabel={tCopy('copied')}
              />
            </Step>
            <Step n={7} title={t('step.boot')}>
              <p className="text-sm text-muted-foreground">
                {t('step.bootBody', { label: plan.bootLabel })}
              </p>
              <CopyableCommand
                command={plan.commands.boot}
                copyLabel={tCopy('copy')}
                copiedLabel={tCopy('copied')}
              />
            </Step>
            <Step n={8} title={t('step.test')}>
              <p className="text-sm text-muted-foreground">{t('step.testBody')}</p>
            </Step>
          </ol>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RecoverySection({ plan }: { plan: ReturnType<typeof recoveryPlan> }) {
  const t = useTranslations('server.disks.recover');
  const tCopy = useTranslations('common');
  const command = (value: string) => (
    <CopyableCommand command={value} copyLabel={tCopy('copy')} copiedLabel={tCopy('copied')} />
  );
  return (
    <Collapsible
      defaultOpen={plan.missing}
      className="rounded-lg border border-sidebar-border bg-card"
    >
      <CollapsibleTrigger className="group flex min-h-8 w-full items-center gap-2 px-3 py-1.5 text-start text-sm font-medium hover:bg-sidebar-accent">
        <ChevronRight className="size-4 shrink-0 transition-transform duration-150 group-data-[state=open]:rotate-90 rtl:group-data-[state=closed]:rotate-180" />
        {t('open', { letter: plan.letter })}
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 px-3 pt-1 pb-3">
        <p className="text-sm text-muted-foreground">{t('intro')}</p>
        <ol className="space-y-4">
          <Step n={1} title={t('step.poweroff')}>
            <p className="text-sm text-muted-foreground">{t('step.poweroffBody')}</p>
            {command(plan.commands.poweroff)}
          </Step>
          <Step n={2} title={t('step.powerOn')}>
            <p className="text-sm text-muted-foreground">{t('step.powerOnBody')}</p>
          </Step>
          <Step n={3} title={t('step.smart')}>
            <p className="text-sm text-muted-foreground">{t('step.smartBody')}</p>
            {command(plan.commands.smart)}
          </Step>
          <Step n={4} title={t('step.readd')}>
            <p className="text-sm text-muted-foreground">{t('step.readdBody')}</p>
            {command(plan.commands.readd)}
          </Step>
          <Step n={5} title={t('step.esp')}>
            <p className="text-sm text-muted-foreground">
              {t('step.espBody', { mount: plan.espMount })}
            </p>
            {command(plan.commands.esp)}
            {command(plan.commands.bootCheck)}
            {command(plan.commands.bootRepair)}
            {command(plan.commands.espCopy)}
          </Step>
        </ol>
        <p className="text-sm">{t('replaceWhen')}</p>
      </CollapsibleContent>
    </Collapsible>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="space-y-2">
      <h4 className="flex items-center gap-2 text-sm font-medium">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs">
          {n}
        </span>
        {title}
      </h4>
      <div className="space-y-2 ps-7">{children}</div>
    </li>
  );
}
