'use client';

import { useState } from 'react';
import { OctagonX, Play } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import ConfirmDialog from '@/components/common/overlay/ConfirmDialog';
import { useSession } from '@/lib/auth-client';
import { formatDateTime } from '@/utils/dates';
import { useEmergencyStop, useSetEmergencyStop } from '../services/agentRuntime.service';

// The instance-wide "Not-Aus": while it is on, no agent starts or continues a run or a chat
// answer, runs in flight are released at their next heartbeat (and resume their session
// once it is lifted), and every Hermes profile is paused. Only the instance owner turns it
// on or off; everyone sees that it is on.

// The bar under the header on every page while the stop is on.
export function EmergencyStopBanner() {
  const t = useTranslations('agentRuntime.emergencyStop');
  const stop = useEmergencyStop().data;
  const set = useSetEmergencyStop();
  const { data: session } = useSession();
  const isGod = (session?.user as { role?: string } | undefined)?.role === 'god';
  if (!stop?.active) return null;
  return (
    <div
      role="alert"
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive"
    >
      <OctagonX className="size-4 shrink-0" aria-hidden="true" />
      <span className="font-medium">{t('bannerTitle')}</span>
      <span className="min-w-0 flex-1 text-xs">
        {stop.since ? t('bannerSince', { since: formatDateTime(stop.since) }) : null}
        {stop.reason ? ` · ${stop.reason}` : ''}
      </span>
      {isGod && (
        <Button
          size="sm"
          variant="outline"
          className="h-7"
          disabled={set.isPending}
          onClick={() =>
            set.mutate({ active: false }, { onSuccess: () => toast.success(t('lifted')) })
          }
        >
          <Play />
          {t('resume')}
        </Button>
      )}
    </div>
  );
}

// The confirmation before the owner turns the stop on, with an optional reason everyone sees.
export function EmergencyStopDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations('agentRuntime.emergencyStop');
  const set = useSetEmergencyStop();
  const [reason, setReason] = useState('');
  return (
    <ConfirmDialog
      title={t('confirmTitle')}
      confirmLabel={t('stop')}
      onClose={onClose}
      onConfirm={async () => {
        await set.mutateAsync({ active: true, reason: reason.trim() || null });
        toast.success(t('engaged'));
        onClose();
      }}
    >
      <p className="text-sm text-muted-foreground">{t('confirmText')}</p>
      <Input
        value={reason}
        maxLength={300}
        placeholder={t('reasonPlaceholder')}
        aria-label={t('reason')}
        onChange={(event) => setReason(event.target.value)}
      />
    </ConfirmDialog>
  );
}

// The owner's control: "Not-Aus" while agents run, "Fortsetzen" while the stop is on.
export function EmergencyStopControl() {
  const t = useTranslations('agentRuntime.emergencyStop');
  const stop = useEmergencyStop();
  const set = useSetEmergencyStop();
  const [confirming, setConfirming] = useState(false);
  const active = stop.data?.active ?? false;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p className="min-w-0 flex-1 text-sm text-muted-foreground">
        {active
          ? t('activeSince', {
              since: stop.data?.since ? formatDateTime(stop.data.since) : '—',
            })
          : t('inactive')}
        {active && stop.data?.reason ? ` · ${stop.data.reason}` : ''}
      </p>
      {active ? (
        <Button
          variant="outline"
          disabled={set.isPending}
          onClick={() =>
            set.mutate({ active: false }, { onSuccess: () => toast.success(t('lifted')) })
          }
        >
          <Play />
          {t('resume')}
        </Button>
      ) : (
        <Button variant="destructive" disabled={stop.isPending} onClick={() => setConfirming(true)}>
          <OctagonX />
          {t('stop')}
        </Button>
      )}
      {confirming && <EmergencyStopDialog onClose={() => setConfirming(false)} />}
    </div>
  );
}
