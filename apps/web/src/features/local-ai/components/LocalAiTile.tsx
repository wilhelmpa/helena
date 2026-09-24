'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { FigureTile } from '@/features/home/dashboard/DashboardParts';
import { useLocalAiStatus } from '../services/localAi.service';
import { shortModel } from '../utils/localAi';
import LocalAiCard from './LocalAiCard';

// Start → the figure tile "Lokale KI" (docs/helena-decisions/dashboard.md; local-ai-platform.md
// §7.5), for the Administrator: An or Aus, the GPU's load and the model in memory, red while an
// enabled server does not answer. A click opens the card with the master switch, the units,
// the kinds of work and "Jev / Laya (experimentell)". Shown only once a model server is set
// up; red problems go to "Braucht dich" (localAiProblems), not here.
export default function LocalAiTile() {
  const t = useTranslations('localAi');
  const [open, setOpen] = useState(false);
  const status = useLocalAiStatus().data;
  if (!status || status.servers.length === 0) return null;
  const on = status.enabled;
  const down = on && status.servers.some((server) => server.enabled && !server.reachable);
  const { gpu, npu, cpu } = status.units;
  const loaded = [...gpu.loaded, ...npu.loaded, ...cpu.loaded][0];
  const sub = !on
    ? t('tile.offSub')
    : down
      ? t('card.serverDown')
      : loaded
        ? shortModel(loaded.modelId)
        : t('card.noModel');
  return (
    <>
      <FigureTile
        onSelect={() => setOpen(true)}
        label={t('title')}
        value={on ? t('card.on') : t('card.off')}
        status={!on ? undefined : down ? 'danger' : loaded ? 'running' : 'success'}
        progress={
          on && !down && gpu.busyPercent != null
            ? { percent: gpu.busyPercent, className: 'bg-status-running' }
            : null
        }
        sub={sub}
        subTone={down ? 'danger' : 'default'}
        title={sub}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          aria-describedby={undefined}
          className="max-h-[85vh] overflow-y-auto sm:max-w-2xl"
        >
          {/* The card names itself; the dialog's title is for screen readers. */}
          <DialogTitle className="sr-only">{t('title')}</DialogTitle>
          <LocalAiCard className="border-0 bg-transparent p-0" />
        </DialogContent>
      </Dialog>
    </>
  );
}
