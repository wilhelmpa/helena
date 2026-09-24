'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Cycle } from '@/lib/api/endpoints/cycles';
import { CYCLE_STATUS_META } from '@/utils/cycleMeta';
import { cn } from '@/lib/utils';
import { colorDot } from '@/components/common/fields/colorDot';
import ProgressBar from '@/components/common/ProgressBar';
import { PAGE_CONTROL_CLASS, usePageToolbarRoom } from '@/components/layout/PageToolbar';
import CycleActions from '../CycleActions';
import CycleRange from '../CycleRange';
import TransferIssuesDialog from '../TransferIssuesDialog';

// What the cycle detail page says about its cycle, at the start of its header row
// (the breadcrumb already names it): the status its dates put it in, the range, the
// goal while there is room, and how much of it is done.
export function CycleSummary({ cycle }: { cycle: Cycle }) {
  const t = useTranslations('cycles');
  const room = usePageToolbarRoom();
  const status = CYCLE_STATUS_META[cycle.status];
  return (
    <div className="flex min-w-0 shrink-0 items-center gap-3 ps-1 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        {colorDot(status.color)}
        {t(`status.${cycle.status}`)}
      </span>
      {room.actions ? <CycleRange cycle={cycle} /> : null}
      {cycle.goal && room.search ? (
        <span className="max-w-64 truncate" title={cycle.goal}>
          {cycle.goal}
        </span>
      ) : null}
      <ProgressBar progress={cycle.progress} />
    </div>
  );
}

// The cycle's menu at the end of the header row. The transfer dialog is held here,
// the way the cycles table holds it.
export default function CycleHeaderActions({
  cycle,
  projectKey,
}: {
  cycle: Cycle;
  projectKey: string;
}) {
  const [transferring, setTransferring] = useState(false);
  return (
    <>
      <CycleActions
        cycle={cycle}
        projectKey={projectKey}
        onTransfer={() => setTransferring(true)}
        triggerClassName={cn(PAGE_CONTROL_CLASS, 'w-8 justify-center px-0')}
      />
      {transferring && (
        <TransferIssuesDialog
          cycle={cycle}
          projectKey={projectKey}
          onClose={() => setTransferring(false)}
        />
      )}
    </>
  );
}
